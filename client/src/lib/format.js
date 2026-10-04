// Display helpers shared across screens.

export const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');

// "5 min ago", "3 h ago", falling back to a date for anything older than a week.
export function fmtRelative(d) {
  if (!d) return '—';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : fmtDate(d);
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

// Shift times are shown in Nairobi time (DR-02), whatever the browser's zone.
const NAIROBI_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const NAIROBI_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short' });
export const fmtNairobiTime = (d) => (d ? `${NAIROBI_TIME.format(new Date(d))} EAT` : '—');
export const fmtNairobiDay = (d) => (d ? NAIROBI_DAY.format(new Date(d)) : '—');

// 25 min, 3 h 10 min, 2 d 4 h
export function fmtDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
