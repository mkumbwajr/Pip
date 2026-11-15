#!/usr/bin/env python3
"""Pip accounts: keeps a signed-in user's Pip preferences so another PC or Mac can pick them up.

Runs on BANG DIGITAL's server behind Nginx (https://pip.bang.co.tz/api/...), as a systemd service with no fixed user
(DynamicUser) and its data in /var/lib/pip-api. Python's standard library only: nothing to install.

  POST   /api/login    {"idToken": "..."}            Google says who you are -> {"token", "email"}
  GET    /api/prefs    Authorization: Bearer <token>  -> {"data": {...} | null, "updatedAt": ms}
  PUT    /api/prefs    {"data": {...}, "updatedAt": ms} -> {"updatedAt": ms}
  POST   /api/logout   ends this device's session
  DELETE /api/account  deletes your preferences and every session, on every device

Who you are comes only from Google (an ID token checked with Google, for Pip's own OAuth client). No passwords.
Users are stored under a hash of their Google ID; session tokens are stored as hashes too.
"""
import hashlib, json, os, re, shutil, secrets, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PIP_API_PORT', '48620'))
DATA = os.environ.get('STATE_DIRECTORY') or os.environ.get('PIP_API_DATA') or '/var/lib/pip-api'
CLIENT_IDS = set(filter(None, os.environ.get('PIP_GOOGLE_CLIENT_IDS', '').split(',')))  # Pip's own OAuth client(s)
MAX_BODY = 256 * 1024           # preferences and the note together
SESSION_DAYS = 365
RELAY_MS = 3600 * 1000           # a relay box lives one hour
RELAY_FILE_MAX = 200 * 1024 * 1024 # one file
RELAY_BOX_MAX = 600 * 1024 * 1024  # all files in one box
ID_RE = re.compile(r'^[A-Za-z0-9_-]{16,40}$')
lock = threading.Lock()
hits = {}                       # ip -> [window start, count]

def h(s): return hashlib.sha256(s.encode()).hexdigest()
def path(*p): return os.path.join(DATA, *p)
def now_ms(): return int(time.time() * 1000)

def read_json(p, default):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return default
def write_json(p, value):
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(value, f)
    os.replace(tmp, p)

def sessions(): return read_json(path('sessions.json'), {})
def save_sessions(s): write_json(path('sessions.json'), s)

def list_box(folder):
    out = []
    for f in sorted(os.listdir(folder)):
        if f.endswith('.json'):
            m = read_json(os.path.join(folder, f), None)
            if m: out.append(m)
    return out
def box_size(box):
    total = 0
    for root, _, files in os.walk(box):
        for f in files:
            try: total += os.path.getsize(os.path.join(root, f))
            except OSError: pass
    return total
def remove_box(box): shutil.rmtree(box, ignore_errors=True)
last_sweep = [0]
def sweep_relay():
    """Deletes boxes past their hour, at most once a minute."""
    if time.time() - last_sweep[0] < 60: return
    last_sweep[0] = time.time()
    root = path('relay')
    for b in os.listdir(root) if os.path.isdir(root) else []:
        meta = read_json(os.path.join(root, b, 'meta.json'), None)
        if not meta or meta.get('expires', 0) < now_ms(): remove_box(os.path.join(root, b))

def google_user(id_token):
    """Asks Google whether the ID token is real and meant for Pip; returns (google id, email) or None."""
    try:
        url = 'https://oauth2.googleapis.com/tokeninfo?' + urllib.parse.urlencode({'id_token': id_token})
        with urllib.request.urlopen(url, timeout=10) as r: info = json.load(r)
    except Exception: return None
    if info.get('aud') not in CLIENT_IDS: return None
    if info.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'): return None
    if int(info.get('exp', 0)) < time.time(): return None
    if str(info.get('email_verified')).lower() != 'true' or not info.get('sub'): return None
    return info['sub'], info.get('email', '')

class Api(BaseHTTPRequestHandler):
    server_version = 'pip-api'
    def log_message(self, *a): pass  # no request log with addresses or emails; Nginx keeps the usual access log

    def reply(self, code, body=None):
        raw = json.dumps(body if body is not None else {}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def limited(self):
        ip = self.headers.get('X-Real-IP') or self.client_address[0]
        with lock:
            w = hits.get(ip)
            if not w or time.time() - w[0] > 60: hits[ip] = [time.time(), 1]; return False
            w[1] += 1; return w[1] > 120  # two requests a second on average is far more than Pip sends

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:  # read it away (up to 2 MB) so the answer reaches the client, then close
            self.rfile.read(min(n, 2 * 1024 * 1024)); self.close_connection = True; return None
        try: return json.loads(self.rfile.read(n) or b'{}')
        except ValueError: return None

    def who(self):
        a = self.headers.get('Authorization', '')
        if not a.startswith('Bearer '): return None, None
        key = h(a[7:].strip())
        with lock: s = sessions().get(key)
        if not s or s.get('expires', 0) < now_ms(): return None, None
        return s['user'], key

    def route(self, method):
        if self.limited(): return self.reply(429, {'error': 'Too many requests'})
        p = urllib.parse.urlparse(self.path).path.rstrip('/')
        if p.startswith('/api/relay'): return self.relay(method, p)
        if method == 'POST' and p == '/api/login':
            b = self.body() or {}
            u = google_user(str(b.get('idToken', ''))[:4096])
            if not u: return self.reply(401, {'error': 'Google sign-in could not be checked'})
            user, token = h('google:' + u[0]), secrets.token_urlsafe(32)
            with lock:
                s = sessions(); s[h(token)] = {'user': user, 'created': now_ms(), 'expires': now_ms() + SESSION_DAYS * 86400000}
                save_sessions(s)
            return self.reply(200, {'token': token, 'email': u[1]})
        user, key = self.who()
        if not user: return self.reply(401, {'error': 'Sign in again'})
        file = path('users', user + '.json')
        if method == 'GET' and p == '/api/prefs':
            d = read_json(file, None)
            return self.reply(200, {'data': d['data'] if d else None, 'updatedAt': d['updatedAt'] if d else 0})
        if method == 'PUT' and p == '/api/prefs':
            b = self.body()
            if not isinstance(b, dict) or not isinstance(b.get('data'), dict): return self.reply(400, {'error': 'Preferences missing or too big'})
            at = int(b.get('updatedAt') or now_ms())
            with lock: write_json(file, {'data': b['data'], 'updatedAt': at})
            return self.reply(200, {'updatedAt': at})
        if method == 'POST' and p == '/api/logout':
            with lock:
                s = sessions(); s.pop(key, None); save_sessions(s)
            return self.reply(200, {'ok': True})
        if method == 'DELETE' and p == '/api/account':
            with lock:
                try: os.remove(file)
                except OSError: pass
                s = {k: v for k, v in sessions().items() if v.get('user') != user}; save_sessions(s)
            return self.reply(200, {'ok': True})
        return self.reply(404, {'error': 'Not found'})

    # ---------- the file relay: phone and computer on different networks ----------
    # A box lives one hour. Everything in it was encrypted by the sender with a key that never reaches this server (it
    # sits after the # of the link in the QR code), so the server stores and passes on bytes it cannot read.
    #   POST /api/relay                          the computer opens a box -> {id, pc}  (pc: the computer's own secret)
    #   PUT  /api/relay/<id>/in                  the phone sends a file (header X-Name: its encrypted name)
    #   GET  /api/relay/<id>/in?pc=..            the computer lists what came in, with progress while it arrives
    #   GET  /api/relay/<id>/in/<n>?pc=..        the computer fetches one (then it is deleted)
    #   PUT  /api/relay/<id>/out?pc=..           the computer offers a file to the phone (X-Name)
    #   GET  /api/relay/<id>/out                 the phone lists what is offered;  GET .../out/<n> fetches one
    #   DELETE /api/relay/<id>?pc=..             the computer closes the box early
    def relay(self, method, p):
        parts = p.split('/')[3:]  # after /api/relay
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        sweep_relay()
        if method == 'POST' and not parts:
            box, pc = secrets.token_urlsafe(16), secrets.token_urlsafe(24)
            d = path('relay', box); os.makedirs(os.path.join(d, 'in')); os.makedirs(os.path.join(d, 'out'))
            write_json(os.path.join(d, 'meta.json'), {'pc': h(pc), 'expires': now_ms() + RELAY_MS})
            return self.reply(200, {'id': box, 'pc': pc, 'expires': now_ms() + RELAY_MS})
        if not parts or not ID_RE.match(parts[0]): return self.reply(404, {'error': 'No such box'})
        d = path('relay', parts[0]); meta = read_json(os.path.join(d, 'meta.json'), None)
        if not meta or meta['expires'] < now_ms(): return self.reply(404, {'error': 'This link has expired'})
        is_pc = h((q.get('pc') or [''])[0]) == meta['pc']
        rest = parts[1:]
        if method == 'DELETE' and not rest and is_pc: remove_box(d); return self.reply(200, {'ok': True})
        if len(rest) >= 1 and rest[0] in ('in', 'out'):
            side = rest[0]; folder = os.path.join(d, side)
            if method == 'PUT' and len(rest) == 1:
                if side == 'out' and not is_pc: return self.reply(403, {'error': 'Not allowed'})
                return self.receive(folder, d)
            if method == 'GET' and len(rest) == 1:
                if side == 'in' and not is_pc: return self.reply(403, {'error': 'Not allowed'})
                return self.reply(200, {'files': list_box(folder), 'expires': meta['expires']})
            if method == 'GET' and len(rest) == 2 and rest[1].isdigit():
                if side == 'in' and not is_pc: return self.reply(403, {'error': 'Not allowed'})
                f = os.path.join(folder, rest[1] + '.bin')
                if not os.path.exists(f): return self.reply(404, {'error': 'Gone'})
                self.send_response(200); self.send_header('Content-Type', 'application/octet-stream'); self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(os.path.getsize(f))); self.end_headers()
                with open(f, 'rb') as src:
                    while True:
                        chunk = src.read(1 << 20)
                        if not chunk: break
                        self.wfile.write(chunk)
                if side == 'in':  # delivered to the computer: nothing is kept
                    for ext in ('.bin', '.json'):
                        try: os.remove(os.path.join(folder, rest[1] + ext))
                        except OSError: pass
                return
        return self.reply(404, {'error': 'Not found'})

    def receive(self, folder, box):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > RELAY_FILE_MAX: return self.reply(413, {'error': 'Too big'})
        if box_size(box) + n > RELAY_BOX_MAX: return self.reply(413, {'error': 'This box is full'})
        name = str(self.headers.get('X-Name', ''))[:2000]
        with lock:
            num = str(now_ms()) + str(secrets.randbelow(1000)).zfill(3)
            write_json(os.path.join(folder, num + '.json'), {'n': num, 'name': name, 'size': n, 'got': 0, 'done': False, 'at': now_ms()})
        part = os.path.join(folder, num + '.part'); got = 0; told = time.time()
        try:
            with open(part, 'wb') as out:
                while got < n:
                    chunk = self.rfile.read(min(1 << 20, n - got))
                    if not chunk: break
                    out.write(chunk); got += len(chunk)
                    if time.time() - told > 0.5:  # progress the computer can show while the file arrives
                        told = time.time(); write_json(os.path.join(folder, num + '.json'), {'n': num, 'name': name, 'size': n, 'got': got, 'done': False, 'at': now_ms()})
        except OSError: pass
        if got < n:
            for f in (part, os.path.join(folder, num + '.json')):
                try: os.remove(f)
                except OSError: pass
            self.close_connection = True; return
        os.replace(part, os.path.join(folder, num + '.bin'))
        write_json(os.path.join(folder, num + '.json'), {'n': num, 'name': name, 'size': n, 'got': n, 'done': True, 'at': now_ms()})
        return self.reply(200, {'n': num})

    def do_GET(self): self.route('GET')
    def do_PUT(self): self.route('PUT')
    def do_POST(self): self.route('POST')
    def do_DELETE(self): self.route('DELETE')

if __name__ == '__main__':
    if not CLIENT_IDS: sys.exit('PIP_GOOGLE_CLIENT_IDS is not set')
    os.makedirs(path('users'), exist_ok=True); os.makedirs(path('relay'), exist_ok=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Api).serve_forever()
