// Calendar helpers (Part K). Only the shift name, its times and the
// department ever go into a calendar: never handover content.
import api from '../api';
import { shiftLabel } from './format';

const NAIROBI_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// 20261013T180000: the Nairobi wall-clock time Google expects with ctz.
function nairobiCompact(d) {
  const p = Object.fromEntries(NAIROBI_PARTS.formatToParts(new Date(d)).map(({ type, value }) => [type, value]));
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

// "Add to Google Calendar": Google's event template link, in Nairobi time.
// Opening it sends these few fields to Google; nothing is sent until the user
// saves the event there.
export function googleCalendarUrl(shift) {
  const title = `${shiftLabel(shift)} - ${shift.department_name}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${nairobiCompact(shift.start_time)}/${nairobiCompact(shift.end_time)}`,
    ctz: 'Africa/Nairobi',
    details: `${shiftLabel(shift)}, ${shift.department_name}. From Shift Handover.`,
    location: shift.department_name,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// "Download .ics": the API writes the file (name, times, department and a
// 30-minute reminder); the browser saves it.
export async function downloadIcs(params) {
  const res = await api.get('/shifts/calendar.ics', { params, responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] ?? '')?.[1] ?? 'shifts.ics';
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
