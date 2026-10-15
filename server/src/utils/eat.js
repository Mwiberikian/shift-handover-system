// The one server-side formatter for East Africa Time (UTC+3, no daylight
// saving), matching the client's `YYYY-MM-DD HH:mm EAT` (DR-02).
//
//   formatEAT(date)              '2026-10-14 18:00 EAT'
//   formatEAT(date, 'date')      '2026-10-14'
//   formatEAT(date, 'time')      '18:00 EAT'
const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function formatEAT(value, style = 'datetime') {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = Object.fromEntries(PARTS.formatToParts(date).map(({ type, value: v }) => [type, v]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute} EAT`;
  if (style === 'date') return day;
  if (style === 'time') return time;
  return `${day} ${time}`;
}

module.exports = { formatEAT };
