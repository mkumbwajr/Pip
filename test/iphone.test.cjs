const test = require('node:test'), assert = require('node:assert');
const { textFromAttributed, firstLine, phoneKey, callerFrom } = require('../src/main/mac-alerts.js');

// a typedstream like the one Messages stores: class name, then 0x2B, a length and the UTF-8 text
const body = (text, long = false) => {
  const t = Buffer.from(text, 'utf8'), len = long ? Buffer.from([0x81, t.length & 255, t.length >> 8]) : Buffer.from([t.length]);
  return Buffer.concat([Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01', 'latin1'), Buffer.from([0x2b]), len, t, Buffer.from([0x86, 0x84])]).toString('hex');
};

test('messages: text from attributedBody, short and long', () => {
  assert.equal(textFromAttributed(body('Uko wapi? 😀')), 'Uko wapi? 😀');
  const long = 'a'.repeat(300);
  assert.equal(textFromAttributed(body(long, true)), long);
  assert.equal(textFromAttributed(''), '');
  assert.equal(textFromAttributed('00ff'), '');
});

test('messages: first line only, trimmed for the island', () => {
  assert.equal(firstLine('Habari\nya pili'), 'Habari');
  assert.equal(firstLine('￼  picha'), 'picha');
  assert.equal(firstLine('x'.repeat(200)).length, 90);
});

test('messages: phone numbers match on their last nine digits', () => {
  assert.equal(phoneKey('+255 712 345 678'), phoneKey('0712345678'));
  assert.equal(phoneKey('abc'), '');
});

test('calls: an alert with Accept/Decline is a call, and its caller is found', () => {
  assert.equal(callerFrom(['Mama', 'iPhone Call'], ['Accept', 'Decline']), 'Mama');
  assert.equal(callerFrom(['FaceTime Audio', 'Juma'], ['Decline', 'Accept']), 'Juma');
  assert.equal(callerFrom(['Reminders', 'Buy milk'], ['Close']), '');
  assert.equal(callerFrom(['Mama', 'Call me later'], ['Reply']), '');
});
