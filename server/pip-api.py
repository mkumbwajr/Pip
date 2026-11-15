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
import hashlib, json, os, secrets, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PIP_API_PORT', '48620'))
DATA = os.environ.get('STATE_DIRECTORY') or os.environ.get('PIP_API_DATA') or '/var/lib/pip-api'
CLIENT_IDS = set(filter(None, os.environ.get('PIP_GOOGLE_CLIENT_IDS', '').split(',')))  # Pip's own OAuth client(s)
MAX_BODY = 256 * 1024           # preferences and the note together
SESSION_DAYS = 365
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

    def do_GET(self): self.route('GET')
    def do_PUT(self): self.route('PUT')
    def do_POST(self): self.route('POST')
    def do_DELETE(self): self.route('DELETE')

if __name__ == '__main__':
    if not CLIENT_IDS: sys.exit('PIP_GOOGLE_CLIENT_IDS is not set')
    os.makedirs(path('users'), exist_ok=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Api).serve_forever()
