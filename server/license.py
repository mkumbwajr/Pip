"""Pip's license and donations. The paywall is removed (2026-11-16): Pip is free for everyone, every tab open. This
file still keeps the trial/license machinery (for an account that bought before then) and adds donations of any
amount, both paid through EvPay (mobile money or card).

Used by pip-api.py. Python's standard library only.

  Trial      Counted by the server from the first time it sees a device (a one-way hash of the device's ID, sent by Pip),
             so neither reinstalling nor changing the computer's clock restarts it. No longer locks anything.
  License    Belongs to a Pip account (Google or email). Kept only for accounts that already bought one.
  Donation   Any amount between MIN_DONATE_TZS and MAX_DONATE_TZS, from Settings -> Support. Grants nothing.
  Payment    EvPay, in Tanzanian shillings. Mobile money: a prompt on the payer's phone (USSD push). Card: EvPay's own
             hosted page (card details never touch Pip). EvPay tells this server the result with a signed webhook.

Configuration (environment, from /etc/pip-api-evpay.env, root-only, never in git):
  EVPAY_BASE_URL, EVPAY_CLIENT_ID, EVPAY_CLIENT_SECRET   EvPay API (live: https://api.evpay.co.tz; docs.evpay.co.tz)
  EVPAY_SIG_KEY            signs requests to EvPay and checks its webhooks (EvPay's documented default: the client secret)
  EVPAY_WEBHOOK_SECRET     only if EvPay issued a separate webhook secret
  PIP_PRICE_TZS            default 5000      PIP_TRIAL_DAYS   default 7
  PIP_PUBLIC_URL           default https://pip.bang.co.tz (where EvPay sends the webhook and the card page returns)
"""
import hashlib, hmac, json, os, re, secrets, sys, threading, time, urllib.error, urllib.request

PRICE_TZS = int(os.environ.get('PIP_PRICE_TZS', '5000'))
TRIAL_DAYS = int(os.environ.get('PIP_TRIAL_DAYS', '7'))
# The paywall is removed (2026-11-16): PRICE_TZS/TRIAL_DAYS stay only for an account that already bought before then.
# Donations use these instead - any amount in between, so a typo or a stray tap cannot send too little or too much.
MIN_DONATE_TZS = int(os.environ.get('PIP_MIN_DONATE_TZS', '500'))
MAX_DONATE_TZS = int(os.environ.get('PIP_MAX_DONATE_TZS', '2000000'))
PUBLIC_URL = os.environ.get('PIP_PUBLIC_URL', 'https://pip.bang.co.tz').rstrip('/')
DEVICE_RE = re.compile(r'^[0-9a-f]{64}$')  # Pip sends a SHA-256 of the machine ID, never the ID itself
PRODUCT = 'Pip license'
UA = 'pip-api/1.0 (+https://pip.bang.co.tz)'  # EvPay sits behind Cloudflare, which turns away clients without a name

lock = threading.Lock()

def h(s): return hashlib.sha256(s.encode()).hexdigest()
def now_ms(): return int(time.time() * 1000)

class Store:
    """Trials, licenses, orders and webhook deliveries, as JSON files under the service's data folder."""
    def __init__(self, data):
        self.data = data
        for d in ('trials', 'licenses', 'orders'): os.makedirs(os.path.join(data, d), exist_ok=True)
    def p(self, *parts): return os.path.join(self.data, *parts)
    def read(self, p, default=None):
        try:
            with open(p, encoding='utf-8') as f: return json.load(f)
        except (OSError, ValueError): return default
    def write(self, p, value):
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(value, f)
        os.replace(tmp, p)

    # ---- trial and license
    def trial(self, device):
        """When this device's trial started (recorded now if this is the first time)."""
        f = self.p('trials', h('device:' + device) + '.json')
        with lock:
            t = self.read(f)
            if not t: t = {'started': now_ms()}; self.write(f, t)
        return t['started']
    def license(self, user): return self.read(self.p('licenses', user + '.json'))
    def grant(self, user, order, how):
        with lock: self.write(self.p('licenses', user + '.json'), {'at': now_ms(), 'order': order, 'how': how})
    def revoke(self, user, order):
        f = self.p('licenses', user + '.json')
        with lock:
            lic = self.read(f)
            if lic and lic.get('order') == order:  # only the purchase that was refunded, never a later one
                try: os.remove(f)
                except OSError: pass

    def status(self, user, device, selling=True):
        """What Pip needs: licensed, or how long the trial still runs (by the server's clock). While nothing is on sale no
        trial is started, so everyone already using Pip gets the full seven days from the day buying opens."""
        lic = self.license(user) if user else None
        out = {'licensed': bool(lic), 'priceTzs': PRICE_TZS, 'trialDays': TRIAL_DAYS, 'now': now_ms()}
        if device and selling:
            started = self.trial(device)
            out.update({'trialStarted': started, 'trialEndsAt': started + TRIAL_DAYS * 86400000})
        return out

    # ---- orders
    def order(self, ref): return self.read(self.p('orders', ref + '.json')) if re.match(r'^PIP-[A-Za-z0-9_-]{8,40}$', ref or '') else None
    def save_order(self, o):
        with lock: self.write(self.p('orders', o['ref'] + '.json'), o)
    def new_order(self, user, method, amount_tzs=None, kind='license'):
        """kind: 'license' (legacy purchase, still grants a license on payment) or 'donation' (grants nothing)."""
        o = {'ref': 'PIP-' + secrets.token_urlsafe(12), 'user': user, 'method': method,
             'amountTzs': int(amount_tzs) if amount_tzs else PRICE_TZS, 'kind': kind,
             'status': 'pending', 'created': now_ms(), 'evpayId': ''}
        self.save_order(o); return o

    # ---- webhook deliveries: EvPay retries, so each delivery is handled once
    def first_delivery(self, delivery):
        f = self.p('deliveries.json')
        with lock:
            seen = self.read(f, [])
            if delivery in seen: return False
            self.write(f, (seen + [delivery])[-5000:])
        return True

# ---------- phone numbers and networks ----------
# Tanzanian mobile prefixes (after 255 / 0): which mobile-money service answers the prompt
OPERATORS = {
    'Mpesa': ('74', '75', '76'),               # Vodacom
    'TigoPesa': ('65', '67', '71', '77'),      # Yas (formerly Tigo)
    'AirtelMoney': ('68', '69', '78'),
    'HaloPesa': ('61', '62'),                  # Halotel
}
def normalize_phone(raw):
    """'0754 123 456', '+255754123456', '754123456' -> '255754123456', or None."""
    d = re.sub(r'\D', '', str(raw or ''))
    if d.startswith('255') and len(d) == 12: return d
    if d.startswith('0') and len(d) == 10: return '255' + d[1:]
    if len(d) == 9 and d[0] in '67': return '255' + d
    return None
def operator_for(phone):
    for op, prefixes in OPERATORS.items():
        if phone[3:5] in prefixes: return op
    return None

# ---------- EvPay ----------
class EvPayError(Exception): pass

class EvPay:
    """Signed calls to EvPay: a bearer token (about five minutes, renewed early), and every request signed with
    HMAC-SHA256 over "<timestamp>.<raw body>" (X-Timestamp, X-Signature)."""
    def __init__(self, env=os.environ, opener=urllib.request.urlopen):
        self.base = (env.get('EVPAY_BASE_URL') or '').rstrip('/')
        self.client_id, self.client_secret = env.get('EVPAY_CLIENT_ID') or '', env.get('EVPAY_CLIENT_SECRET') or ''
        self.sig_key = env.get('EVPAY_SIG_KEY') or self.client_secret
        self.hook_secret = env.get('EVPAY_SIG_KEY') or env.get('EVPAY_WEBHOOK_SECRET') or self.client_secret
        self.opener = opener; self.token = None; self.token_until = 0; self.tlock = threading.Lock()
    @property
    def ready(self): return bool(self.base and self.client_id and self.client_secret)

    def _http(self, method, url, body, headers):
        req = urllib.request.Request(url, data=body, method=method, headers={**headers, 'User-Agent': UA, 'Accept': 'application/json'})
        try:
            with self.opener(req, timeout=20) as r: return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read() or b'{}')
            except ValueError: return e.code, {}
        except (urllib.error.URLError, OSError, ValueError) as e: raise EvPayError('EvPay could not be reached') from e

    def access_token(self):
        with self.tlock:
            if self.token and self.token_until - 30 > time.time(): return self.token
            # EvPay's own auth endpoint answers unreliably (observed: intermittent 500 "Failed to get access
            # token. Status: 502", i.e. a failure inside EvPay's own infrastructure) - a couple of quick
            # retries clear most of them without the caller ever seeing it.
            code, j, attempts = None, {}, 3
            for attempt in range(attempts):
                try:
                    code, j = self._http('POST', self.base + '/api/auth/v1', json.dumps({'clientId': self.client_id, 'clientSecret': self.client_secret}).encode(), {'Content-Type': 'application/json'})
                except EvPayError:
                    if attempt == attempts - 1: raise
                    time.sleep(0.6 * (attempt + 1)); continue
                # EvPay's docs show {access_token, expires_in}; some accounts answer in the usual envelope {data: {accessToken, expiresIn}}
                d = j.get('data') if isinstance(j.get('data'), dict) else j
                tok, ttl = d.get('access_token') or d.get('accessToken'), d.get('expires_in') or d.get('expiresIn') or 300
                if code in (200, 201) and tok:
                    self.token, self.token_until = tok, time.time() + int(ttl)
                    return self.token
                if code >= 500 and attempt < attempts - 1: time.sleep(0.6 * (attempt + 1)); continue
                break
            raise EvPayError('EvPay sign-in failed (%s)' % code)
    def forget_token(self):
        with self.tlock: self.token = None

    def call(self, method, path, body=None, retry=True):
        if not self.ready: raise EvPayError('Payments are not set up yet')
        raw = json.dumps(body).encode() if body is not None else b''  # these exact bytes are signed and sent
        ts = str(now_ms())
        sig = hmac.new(self.sig_key.encode(), ts.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        code, j = self._http(method, self.base + path, raw or None, {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.access_token(), 'X-Timestamp': ts, 'X-Signature': sig})
        if code == 401 and retry: self.forget_token(); return self.call(method, path, body, False)  # the spec: refresh once, then give up
        if not j.get('success'):
            # EvPay's request_id goes to the log for a support ticket; never the credentials or the payer's number
            print('evpay %s %s failed: %s %s request_id=%s' % (method, path.split('/payment/')[0], code, (j.get('errors') or {}).get('code', ''), j.get('request_id', '')), file=sys.stderr)
            raise EvPayError(str(j.get('message') or 'EvPay said no (%s)' % code)[:200])
        return j.get('data') or {}

    def mobile(self, order, phone, operator):
        donation = order.get('kind') == 'donation'
        d = self.call('POST', '/api/v1/payment/ussd', {'fsOperator': operator, 'amount': order['amountTzs'],
            'product': 'Pip donation' if donation else PRODUCT,
            'callbackUrl': PUBLIC_URL + '/api/evpay/webhook', 'payerAccountId': phone, 'requestId': order['ref'], 'currency': 'TZS',
            'narrative': 'Pip donation' if donation else 'Pip one-time license'})
        return {**d, 'id': d.get('transactionId') or d.get('id') or ''}
    def card(self, order, email):
        donation = order.get('kind') == 'donation'
        back = PUBLIC_URL + '/paid?order=' + order['ref']
        name = (email.split('@')[0] if email else 'Pip') or 'Pip'
        d = self.call('POST', '/api/v1/payment/card', {
            'paymentType': 'card',
            'details': {'amount': order['amountTzs'], 'currency': 'TZS', 'redirectUrl': back, 'cancelUrl': back},
            # EvPay requires every billing field; the buyer's card details go only into EvPay's own page
            'customer': {'firstname': name[:40], 'lastname': 'Pip', 'email': email or 'info@bang.co.tz', 'address': 'Not provided',
                         'city': 'Dar es Salaam', 'state': 'DSM', 'postcode': '00000', 'country': 'TZ'},
            'callbackUrl': PUBLIC_URL + '/api/evpay/webhook', 'metadata': {'orderId': order['ref'], 'donation': donation}})
        return {**d, 'id': d.get('reference') or d.get('id') or ''}
    def payment(self, evpay_id): return self.call('GET', '/api/v1/payment/' + evpay_id)

    def webhook_ok(self, raw, header, tolerance=300):
        """X-EvPay-Signature: "t=<seconds>,v1=<hex HMAC-SHA256 of '<t>.<raw body>'>"; at most five minutes old."""
        if not header or not self.hook_secret: return False
        parts = dict(p.split('=', 1) for p in str(header).split(',') if '=' in p)
        try: t = int(parts.get('t', ''))
        except ValueError: return False
        if abs(int(time.time()) - t) > tolerance: return False
        want = hmac.new(self.hook_secret.encode(), str(t).encode() + b'.' + raw, hashlib.sha256).hexdigest()
        got = parts.get('v1', '')
        return bool(re.match(r'^[0-9a-f]{64}$', got)) and hmac.compare_digest(got, want)

# ---------- what happens when EvPay reports ----------
PAID = {'payment.succeeded', 'payment.settled'}
UNDONE = {'payment.refunded', 'payment.reversed'}
def apply_event(store, event, payload):
    """Marks the order and, for a 'license' order only, grants or takes back the license (a donation never does).
       Returns the order's new status, or None if unknown."""
    d = payload.get('data') if isinstance(payload.get('data'), dict) else {}
    ref = payload.get('requestId') or d.get('requestId') or d.get('orderReference') or (d.get('metadata') or {}).get('orderId')
    o = store.order(ref)
    if not o: return None
    is_license = o.get('kind', 'license') == 'license'
    if event in PAID:
        if o['status'] != 'paid':
            o.update(status='paid', paidAt=now_ms()); store.save_order(o)
            if is_license: store.grant(o['user'], o['ref'], o['method'])
    elif event == 'payment.failed' and o['status'] == 'pending': o['status'] = 'failed'; store.save_order(o)
    elif event == 'payment.on_hold' and o['status'] == 'pending': o['status'] = 'on_hold'; store.save_order(o)
    elif event in UNDONE:
        o['status'] = 'refunded'; store.save_order(o)
        if is_license: store.revoke(o['user'], o['ref'])
    return o['status']

def reconcile(store, evpay, older_than_ms=600000, newest_ms=2 * 86400000):
    """Orders still pending after ten minutes (a missed webhook): asks EvPay for each, up to two days back."""
    if not evpay.ready: return 0
    done = 0
    for f in os.listdir(store.p('orders')):
        o = store.read(store.p('orders', f)) if f.endswith('.json') else None
        if not o or o.get('status') != 'pending': continue
        age = now_ms() - o.get('created', 0)
        if age < older_than_ms or age > newest_ms: continue
        try:
            ev = status_from_evpay(evpay.payment(o['evpayId'] if o.get('method') == 'card' and o.get('evpayId') else o['ref']).get('status'))
            if ev: apply_event(store, ev, {'requestId': o['ref']}); done += 1
        except EvPayError: pass
    return done

def status_from_evpay(text):
    """EvPay's own status words, for checking an order directly when a webhook is slow."""
    s = str(text or '').lower()
    if s in ('success', 'succeeded', 'successful', 'completed', 'settled', 'paid'): return 'payment.succeeded'
    if s in ('failed', 'cancelled', 'canceled', 'expired', 'rejected', 'declined'): return 'payment.failed'
    if s in ('refunded', 'reversed'): return 'payment.refunded'
    return None
