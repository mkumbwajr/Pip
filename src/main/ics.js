'use strict';
// A small iCalendar reader: enough to find the next event in a private calendar link (Google, Outlook, iCloud).
// Handles folded lines, all-day events, UTC and floating times, and simple DAILY / WEEKLY repeats.

function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }

function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const date = z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s);
  return { date, allDay: m[4] === undefined };
}

function parseEvents(text) {
  const events = []; let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase(), value = line.slice(i + 1);
    if (key === 'SUMMARY') cur.title = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim();
    else if (key === 'DTSTART') { const p = parseDate(value); if (p) { cur.start = p.date; cur.allDay = p.allDay; } }
    else if (key === 'DTEND') { const p = parseDate(value); if (p) cur.end = p.date; }
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'STATUS' && /CANCELLED/i.test(value)) cur.cancelled = true;
  }
  return events.filter(e => !e.cancelled);
}

/** The first occurrence of an event that ends after `now` (null when it is over for good). */
function nextOccurrence(event, now) {
  const length = event.end ? event.end - event.start : (event.allDay ? 86400e3 : 3600e3);
  if (event.start.getTime() + length > now) return event.start;
  const freq = /FREQ=(DAILY|WEEKLY)/.exec(event.rrule || '')?.[1]; if (!freq) return null;
  const step = (freq === 'DAILY' ? 1 : 7) * 86400e3 * Math.max(1, Number(/INTERVAL=(\d+)/.exec(event.rrule)?.[1] || 1));
  const until = /UNTIL=([0-9TZ]+)/.exec(event.rrule)?.[1], limit = until ? parseDate(until)?.date.getTime() ?? Infinity : Infinity;
  const count = Number(/COUNT=(\d+)/.exec(event.rrule)?.[1] || 0);
  const n = Math.ceil((now - length - event.start.getTime()) / step);
  const k = Math.max(0, n) + (event.start.getTime() + Math.max(0, n) * step + length > now ? 0 : 1);
  const t = event.start.getTime() + k * step;
  if (t > limit || (count && k >= count)) return null;
  return new Date(t);
}

function nextEvent(text, now = Date.now()) {
  let best = null;
  for (const e of parseEvents(text)) {
    const at = nextOccurrence(e, now); if (!at) continue;
    if (!best || at < best.start) best = { title: e.title || 'Event', start: at, allDay: Boolean(e.allDay) };
  }
  return best;
}

module.exports = { parseEvents, nextEvent, nextOccurrence, parseDate };
