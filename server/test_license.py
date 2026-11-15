"""The license flow end to end against a pretend EvPay: python3 -m unittest server/test_license.py (any OS).

Starts the real pip-api on a free port with a throwaway data folder, and a small fake EvPay that checks Pip's request
signatures the way EvPay does. Nothing here talks to the real EvPay."""
import hashlib, hmac, importlib, json, os, sys, tempfile, threading, time, unittest, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = 'test-client-secret'
fake = {'status': 'pending', 'calls': [], 'bad_sig': 0, 'auth': 0, 'expire_next': False}

class FakeEvPay(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, code=200):
        raw = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def handle_any(self, method):
        raw = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if self.path == '/api/auth/v1':
            b = json.loads(raw); ok = b == {'clientId': 'test-client', 'clientSecret': SECRET}; fake['auth'] += 1
            # the shape in EvPay's docs (not wrapped in the usual envelope)
            return self.send({'success': True, 'code': 200, 'data': {'accessToken': 'tok', 'expiresIn': 36000, 'tokenType': 'Bearer'}} if ok else {'success': False, 'code': 400, 'errors': {'code': 'ERR_102'}}, 200 if ok else 400)
        if fake['expire_next']:  # the token ran out early: EvPay answers 401 once
            fake['expire_next'] = False; return self.send({'success': False, 'code': 401, 'message': 'authentication_required'}, 401)
        want = hmac.new(SECRET.encode(), self.headers['X-Timestamp'].encode() + b'.' + raw, hashlib.sha256).hexdigest()
        if self.headers.get('Authorization') != 'Bearer tok' or self.headers.get('X-Signature') != want:
            fake['bad_sig'] += 1; return self.send({'success': False, 'message': 'bad signature'}, 401)
        fake['calls'].append((method, self.path, json.loads(raw) if raw else None))
        if self.headers.get('User-Agent', '').startswith('Python-urllib'): return self.send({'success': False, 'message': 'blocked like Cloudflare'}, 403)
        if self.path == '/api/v1/payment/ussd': return self.send({'success': True, 'code': 202, 'data': {'requestId': json.loads(raw)['requestId'], 'transactionId': 'E1', 'status': 'PENDING'}}, 202)
        if self.path == '/api/v1/payment/card': return self.send({'success': True, 'code': 201, 'data': {'reference': 'pl_2', 'status': 'PENDING', 'paymentUrl': 'https://pay.example/c/ev-2'}}, 201)
        if self.path.startswith('/api/v1/payment/'): return self.send({'success': True, 'data': {'id': self.path.split('/')[-1], 'status': fake['status']}})
        self.send({'success': False}, 404)
    def do_GET(self): self.handle_any('GET')
    def do_POST(self): self.handle_any('POST')

def serve(handler):
    s = ThreadingHTTPServer(('127.0.0.1', 0), handler); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

class LicenseFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ev = serve(FakeEvPay)
        cls.tmp = tempfile.mkdtemp()
        os.environ.update({'PIP_API_DATA': cls.tmp, 'PIP_GOOGLE_CLIENT_IDS': 'x.apps.googleusercontent.com', 'EVPAY_BASE_URL': 'http://127.0.0.1:%d' % cls.ev.server_port,
                           'EVPAY_CLIENT_ID': 'test-client', 'EVPAY_CLIENT_SECRET': SECRET, 'PIP_PRICE_TZS': '5000'})
        sys.path.insert(0, HERE)
        for m in ('license', 'pip-api'): sys.modules.pop(m, None)
        cls.api = importlib.import_module('pip-api')
        cls.api.store = cls.api.lic.Store(cls.tmp); os.makedirs(os.path.join(cls.tmp, 'users'), exist_ok=True)
        cls.srv = serve(cls.api.Api); cls.base = 'http://127.0.0.1:%d' % cls.srv.server_port
        # a signed-in account (as after Google or email sign-in)
        cls.token = 'session-token-for-tests'; cls.user = cls.api.h('email:buyer@example.com')
        cls.api.save_sessions({cls.api.h(cls.token): {'user': cls.user, 'created': 0, 'expires': cls.api.now_ms() + 86400000}})

    def call(self, method, path, body=None, token=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        h = {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {}), **(headers or {})}
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, data=data, method=method, headers=h), timeout=10) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

    def hook(self, event, ref, delivery, secret=SECRET, age=0):
        t = int(time.time()) - age  # the documented message: {event, timestamp, data: {id, orderReference, status, ...}}
        raw = json.dumps({'event': event, 'timestamp': t, 'data': {'id': 'E1', 'orderReference': ref, 'status': 'SUCCESS', 'amount': 5000, 'currency': 'TZS'}}).encode()
        sig = 't=%d,v1=%s' % (t, hmac.new(secret.encode(), str(t).encode() + b'.' + raw, hashlib.sha256).hexdigest())
        return self.call('POST', '/api/evpay/webhook', raw=raw, headers={'X-EvPay-Signature': sig, 'X-EvPay-Event': event, 'X-EvPay-Delivery': delivery})

    def test_1_trial_is_counted_by_the_server_per_device(self):
        dev = hashlib.sha256(b'machine-1').hexdigest()
        c, a = self.call('POST', '/api/license/status', {'device': dev}); self.assertEqual(c, 200)
        self.assertFalse(a['licensed']); self.assertEqual(a['trialEndsAt'] - a['trialStarted'], 7 * 86400000); self.assertEqual(a['priceTzs'], 5000)
        self.assertTrue(a['selling'], 'EvPay is set up in this test, so Pip may lock after the trial')
        time.sleep(0.01); _, b = self.call('POST', '/api/license/status', {'device': dev})
        self.assertEqual(a['trialStarted'], b['trialStarted'], 'asking again (or reinstalling) does not restart the trial')
        _, c2 = self.call('POST', '/api/license/status', {'device': 'not-a-hash'}); self.assertNotIn('trialEndsAt', c2)
        self.assertEqual(os.listdir(os.path.join(self.tmp, 'trials'))[0].count(dev), 0, 'the device hash is hashed again before it is stored')

    def test_2_buying_needs_an_account_and_a_good_number(self):
        self.assertEqual(self.call('POST', '/api/pay/mobile', {'phone': '0754123456'})[0], 401)
        c, e = self.call('POST', '/api/pay/mobile', {'phone': '12345'}, self.token); self.assertEqual(c, 400)

    def test_3_mobile_money_paid_through_the_webhook(self):
        c, r = self.call('POST', '/api/pay/mobile', {'phone': '+255 754 123 456'}, self.token)
        self.assertEqual(c, 200, r); self.assertEqual(r['operator'], 'Mpesa'); ref = r['order']
        sent = [x for x in fake['calls'] if x[1] == '/api/v1/payment/ussd'][-1][2]
        self.assertEqual((sent['payerAccountId'], sent['amount'], sent['currency'], sent['requestId'], sent['fsOperator']), ('255754123456', 5000, 'TZS', ref, 'Mpesa'))
        self.assertEqual(fake['bad_sig'], 0, 'every request to EvPay carried a valid signature')
        self.assertEqual(self.hook('payment.succeeded', ref, 'd1', secret='wrong')[0], 401, 'a forged webhook is refused')
        self.assertEqual(self.hook('payment.succeeded', ref, 'd1', age=900)[0], 401, 'an old (replayed) webhook is refused')
        self.assertFalse(self.call('POST', '/api/license/status', {}, self.token)[1]['licensed'])
        self.assertEqual(self.hook('payment.succeeded', ref, 'd2')[0], 200)
        self.assertTrue(self.call('POST', '/api/license/status', {}, self.token)[1]['licensed'])
        self.assertEqual(self.call('GET', '/api/pay/' + ref, token=self.token)[1]['status'], 'paid')
        self.assertEqual(self.call('POST', '/api/pay/mobile', {'phone': '0754123456'}, self.token)[0], 409, 'no second purchase')
        # a refund takes the license back; the same delivery again changes nothing
        self.assertEqual(self.hook('payment.refunded', ref, 'd3')[0], 200)
        self.assertFalse(self.call('POST', '/api/license/status', {}, self.token)[1]['licensed'])
        self.assertEqual(self.hook('payment.succeeded', ref, 'd2')[0], 200)
        self.assertFalse(self.call('POST', '/api/license/status', {}, self.token)[1]['licensed'], 'a repeated delivery is handled once')

    def test_4_card_page_and_a_late_webhook(self):
        c, r = self.call('POST', '/api/pay/card', {'email': 'buyer@example.com'}, self.token)
        self.assertEqual(c, 200, r); self.assertEqual(r['checkoutUrl'], 'https://pay.example/c/ev-2')
        card = [x for x in fake['calls'] if x[1] == '/api/v1/payment/card'][-1][2]
        self.assertEqual((card['paymentType'], card['metadata']['orderId'], card['details']['amount']), ('card', r['order'], 5000)); self.assertTrue(card['callbackUrl'].endswith('/api/evpay/webhook'))
        self.assertEqual(sorted(card['customer']), ['address', 'city', 'country', 'email', 'firstname', 'lastname', 'postcode', 'state'], 'every billing field EvPay requires')
        fake['status'] = 'pending'; self.assertEqual(self.call('GET', '/api/pay/' + r['order'], token=self.token)[1]['status'], 'pending')
        # no webhook yet: Pip asks again, and the server checks with EvPay directly
        self.api.checked.clear(); fake['status'] = 'SUCCESS'
        a = self.call('GET', '/api/pay/' + r['order'], token=self.token)[1]
        self.assertEqual((a['status'], a['licensed']), ('paid', True))

    def test_4b_expired_token_is_renewed_once(self):
        self.api.store.revoke(self.user, self.api.store.license(self.user)['order']) if self.api.store.license(self.user) else None
        before = fake['auth']; fake['expire_next'] = True
        c, r = self.call('POST', '/api/pay/mobile', {'phone': '0685000000'}, self.token)
        self.assertEqual(c, 200, r); self.assertEqual(r['operator'], 'AirtelMoney'); self.assertEqual(fake['auth'], before + 1, 'one new token, then the call went through')

    def test_4c_missed_webhook_is_reconciled(self):
        L = self.api.lic; s = self.api.store
        o = s.new_order(self.api.h('email:late@example.com'), 'mobile:Mpesa'); o.update(evpayId='ev-9', created=L.now_ms() - 11 * 60000); s.save_order(o)
        fake['status'] = 'SETTLED'
        self.assertGreaterEqual(L.reconcile(s, self.api.evpay), 1)
        self.assertEqual(s.order(o['ref'])['status'], 'paid'); self.assertTrue(s.license(o['user']))

    def test_5_phone_numbers_and_networks(self):
        L = self.api.lic
        self.assertEqual(L.normalize_phone('0754 123 456'), '255754123456'); self.assertEqual(L.normalize_phone('754123456'), '255754123456')
        self.assertIsNone(L.normalize_phone('0754')); self.assertIsNone(L.normalize_phone('+1 202 555 0100'))
        for n, op in (('0754000000', 'Mpesa'), ('0655000000', 'TigoPesa'), ('0715000000', 'TigoPesa'), ('0685000000', 'AirtelMoney'), ('0625000000', 'HaloPesa')):
            self.assertEqual(L.operator_for(L.normalize_phone(n)), op, n)

    def test_5b_no_trial_starts_before_buying_opens(self):
        s = self.api.lic.Store(self.tmp); dev = hashlib.sha256(b'early-user').hexdigest()
        self.assertNotIn('trialEndsAt', s.status(None, dev, selling=False))
        time.sleep(0.01); a = s.status(None, dev, selling=True)
        self.assertGreater(a['trialStarted'], a['now'] - 1000, 'the seven days start when buying opens')

    def test_6_grant_by_hand(self):
        s = self.api.lic.Store(self.tmp); u = self.api.h('email:gift@example.com'); s.grant(u, 'manual', 'manual')
        self.assertTrue(s.status(u, None)['licensed'])

if __name__ == '__main__': unittest.main()
