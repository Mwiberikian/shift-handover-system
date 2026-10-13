// Display helpers shared across screens.

// DR-02: every date and time is shown in East Africa Time in ISO 8601 order,
// whatever the browser's own time zone or locale:
//   formatEAT(d)          "2026-10-13 18:00 EAT"
//   formatEAT(d, 'date')  "2026-10-13"
//   formatEAT(d, 'time')  "18:00 EAT"
// Built from formatToParts so no locale can reorder or translate the fields.
const EAT_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatEAT(d, part = 'datetime') {
  if (d === null || d === undefined || d === '') return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const p = Object.fromEntries(EAT_PARTS.formatToParts(date).map(({ type, value }) => [type, value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute} EAT`;
  if (part === 'date') return day;
  if (part === 'time') return time;
  return `${day} ${time}`;
}

// A datetime-local value ("2026-10-13T18:05") read as East Africa Time
// (UTC+3, no daylight saving), returned as an ISO 8601 UTC string. The
// browser's own time zone plays no part.
export function eatLocalToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!m) return null;
  const [, y, mo, da, h, mi, se = '0'] = m.map((v, i) => (i === 0 ? v : v && Number(v)));
  return new Date(Date.UTC(y, mo - 1, da, h - 3, mi, se)).toISOString();
}

// The current moment as a datetime-local value in East Africa Time.
export function nowEATLocal(at = new Date()) {
  return new Date(at.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 16);
}

// "5 min ago", "3 h ago", falling back to a date for anything older than a week.
export function fmtRelative(d) {
  if (!d) return '—';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : formatEAT(d, 'date');
}

// "night" -> "Night shift"
export const shiftLabel = (r) => {
  const t = r?.shift_type ?? '';
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} shift`;
};

export const ROLE_LABEL = {
  outgoing_staff: 'Outgoing staff',
  incoming_staff: 'Incoming staff',
  supervisor: 'Supervisor',
  admin: 'Administrator',
};

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Joins truthy class names.
export const cx = (...c) => c.filter(Boolean).join(' ');

// "Tue": the weekday in Nairobi, shown beside an ISO date on the roster.
const NAIROBI_WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short' });
export const fmtWeekdayEAT = (d) => (d ? NAIROBI_WEEKDAY.format(new Date(d)) : '—');

// 25 min, 3 h 10 min, 2 d 4 h
export function fmtDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
