// Minimal iCalendar (RFC 5545) writer for rostered shifts, written by hand:
// TEXT escaping (3.3.11), 75-octet line folding (3.1) and CRLF line ends.
//
// Events carry the shift name, its times and the department, and nothing
// else: never handover content, names of colleagues or record data.

const CRLF = '\r\n';
const NAIROBI_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// TEXT: backslash, semicolon, comma and newlines are escaped.
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Lines longer than 75 octets are split; each continuation starts with one
// space. Never splits a UTF-8 character.
function fold(line) {
  const out = [];
  let current = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (octets + size > limit) {
      out.push(current);
      current = ' ';
      octets = 1;
      limit = 75;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join(CRLF);
}

// 20261013T150000Z
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const shiftName = (s) => `${s.shift_type.charAt(0).toUpperCase()}${s.shift_type.slice(1)} shift`;

function eventLines(s, { stamp, alarmMinutes }) {
  const times = `${NAIROBI_TIME.format(new Date(s.start_time))}-${NAIROBI_TIME.format(new Date(s.end_time))} EAT`;
  return [
    'BEGIN:VEVENT',
    `UID:shift-${s.shift_id}@shms`,
    `DTSTAMP:${utc(stamp)}`,
    `DTSTART:${utc(s.start_time)}`,
    `DTEND:${utc(s.end_time)}`,
    `SUMMARY:${escapeText(`${shiftName(s)} - ${s.department_name}`)}`,
    `DESCRIPTION:${escapeText(`${shiftName(s)}, ${s.department_name}, ${times}. From Shift Handover.`)}`,
    `LOCATION:${escapeText(s.department_name)}`,
    'TRANSP:OPAQUE',
    ...(alarmMinutes ? [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`${shiftName(s)} starts in ${alarmMinutes} minutes`)}`,
      `TRIGGER:-PT${alarmMinutes}M`,
      'END:VALARM',
    ] : []),
    'END:VEVENT',
  ];
}

// shifts: [{ shift_id, shift_type, start_time, end_time, department_name }]
function calendar(shifts, { name = 'Shift Handover shifts', stamp = new Date(), alarmMinutes = 30 } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shift Handover Management System//Shifts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Africa/Nairobi',
    ...shifts.flatMap((s) => eventLines(s, { stamp, alarmMinutes })),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

module.exports = {
  calendar, escapeText, fold, utc,
};
