const test = require('node:test'), assert = require('node:assert');
const { MacAlerts, callerFrom, senderFrom } = require('../src/main/mac-alerts.js');

test('messages: a Messages alert gives only who wrote', () => {
  assert.equal(senderFrom(['Juma', 'Uko wapi?'], ['Messages, Juma, Uko wapi?']), 'Juma');
  assert.equal(senderFrom(['Messages', 'Mama', 'now', 'Habari'], []), 'Mama');
  assert.equal(senderFrom(['Calendar', 'Meeting'], ['Calendar, Meeting']), '');
});

test('calls: an alert with Accept/Decline is a call, and its caller is found', () => {
  assert.equal(callerFrom(['Mama', 'iPhone Call'], ['Accept', 'Decline']), 'Mama');
  assert.equal(callerFrom(['FaceTime Audio', 'Juma'], ['Decline', 'Accept']), 'Juma');
  assert.equal(callerFrom(['Reminders', 'Buy milk'], ['Close']), '');
  assert.equal(callerFrom(['Mama', 'Call me later'], ['Reply']), '');
});

test('alerts: still an event emitter after being switched (main.js listens with .on at start-up)', () => {
  const a = new MacAlerts(); a.set(true, true); // does nothing off a Mac
  assert.equal(typeof a.on, 'function'); let got = null; a.on('message', m => { got = m; }); a.emit('message', { from: 'x' });
  assert.deepEqual(got, { from: 'x' }); a.stop();
});
