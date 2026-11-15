"""The one-time sign-in code email for Pip accounts: a small, plain card in Pip's colours with Pip blinking at the top.

Email apps strip <style> blocks and scripts, so the layout is tables with inline styles, and the blink is a GIF
(site/img/pip-blink.gif, made by tools/make-mail-art.js). A plain-text part goes with it for apps that show no HTML.
"""
import html, os, smtplib, ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

SITE = 'https://pip.bang.co.tz'
VIOLET, INK, SOFT, LINE, PAGE = '#7c5cff', '#16151c', '#6b6a76', '#ecebf2', '#f5f4fb'

TEXT = {
    'sw': {'subject': 'Code yako ya Pip: {code}', 'title': 'Code yako ya kuingia', 'lead': 'Iandike kwenye Pip ili uingie kwenye akaunti yako.',
           'expires': 'Inaisha baada ya dakika 10.', 'ignore': 'Kama hukuomba code hii, puuza email hii. Hakuna kitakachobadilika.',
           'why': 'Umepokea email hii kwa sababu mtu aliandika anwani hii kwenye Pip.'},
    'en': {'subject': 'Your Pip code: {code}', 'title': 'Your sign-in code', 'lead': 'Type it into Pip to sign in to your account.',
           'expires': 'It expires in 10 minutes.', 'ignore': "If you didn't ask for this code, you can ignore this email. Nothing will change.",
           'why': 'You got this email because someone typed this address into Pip.'},
}

def render(code, lang='sw'):
    t = TEXT.get(lang, TEXT['sw'])
    gap = '<td style="width:8px"></td>'  # kept out of the f-string: Python 3.9 (the server's) allows no backslash in one
    digits = gap.join(
        f'<td style="width:44px;height:56px;border-radius:12px;background:#f1edff;color:{VIOLET};font:700 28px/56px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;">{d}</td>'
        for d in code)
    e = html.escape
    body = f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{e(t['title'])}</title></head>
<body style="margin:0;padding:0;background:{PAGE};">
<div style="display:none;max-height:0;overflow:hidden;">{e(t['subject'].format(code=code))} · {e(t['expires'])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE};"><tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid {LINE};border-radius:20px;">
    <tr><td align="center" style="padding:36px 32px 8px;">
      <img src="{SITE}/img/pip-blink.gif" width="72" height="64" alt="Pip" style="display:block;border:0;">
    </td></tr>
    <tr><td align="center" style="padding:12px 32px 0;font:700 22px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:{INK};">{e(t['title'])}</td></tr>
    <tr><td align="center" style="padding:8px 32px 24px;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:{SOFT};">{e(t['lead'])}</td></tr>
    <tr><td align="center" style="padding:0 24px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>{digits}</tr></table></td></tr>
    <tr><td align="center" style="padding:20px 32px 0;font:600 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:{VIOLET};">{e(t['expires'])}</td></tr>
    <tr><td style="padding:28px 32px 0;"><div style="height:1px;background:{LINE};"></div></td></tr>
    <tr><td align="center" style="padding:18px 32px 32px;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:{SOFT};">{e(t['ignore'])}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
    <tr><td align="center" style="padding:20px 24px 0;font:12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#9a99a6;">
      {e(t['why'])}<br>
      <a href="{SITE}" style="color:{VIOLET};text-decoration:none;font-weight:600;">Pip</a> &middot; BANG DIGITAL LTD &middot;
      <a href="{SITE}/privacy" style="color:#9a99a6;">Privacy</a> &middot; <a href="{SITE}/terms" style="color:#9a99a6;">Terms</a>
    </td></tr>
  </table>
</td></tr></table></body></html>"""
    plain = f"{t['title']}: {code}\n\n{t['lead']}\n{t['expires']}\n\n{t['ignore']}\n\nPip · BANG DIGITAL LTD · {SITE}\n"
    return t['subject'].format(code=code), plain, body

def send_code(to, code, lang='sw'):
    """Sends the code through the SMTP account in the service's environment (set on the server only)."""
    host, port = os.environ['PIP_SMTP_HOST'], int(os.environ.get('PIP_SMTP_PORT', '465'))
    user, password, sender = os.environ['PIP_SMTP_USER'], os.environ['PIP_SMTP_PASS'], os.environ.get('PIP_MAIL_FROM') or os.environ['PIP_SMTP_USER']
    subject, plain, body = render(code, lang)
    msg = EmailMessage()
    msg['Subject'], msg['From'], msg['To'] = subject, formataddr(('Pip', sender)), to
    msg['Message-ID'] = make_msgid(domain=sender.split('@')[-1])
    msg.set_content(plain); msg.add_alternative(body, subtype='html')
    with smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) as s:
        s.login(user, password); s.send_message(msg)
