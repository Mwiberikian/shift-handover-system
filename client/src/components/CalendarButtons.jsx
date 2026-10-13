import { CalendarPlus, Download, Info } from 'lucide-react';
import { Button, buttonClass } from './ui';
import { googleCalendarUrl, downloadIcs } from '../lib/calendar';
import { formatEAT, shiftLabel } from '../lib/format';
import useAction from '../lib/useAction';

export const CALENDAR_NOTE = 'Shifts you add to Google Calendar, Outlook or another calendar leave Shift Handover: '
  + 'their name, times and department are then held by that calendar service.';

// One-line notice shown wherever shifts can be sent to an external calendar.
export function CalendarNote({ className }) {
  return (
    <p className={['flex items-start gap-1.5 text-meta text-ink-600', className].filter(Boolean).join(' ')}>
      <Info aria-hidden className="mt-px size-3.5 shrink-0" />
      {CALENDAR_NOTE}
    </p>
  );
}

// Per-shift calendar actions: Google Calendar template link and a .ics file.
export function ShiftCalendarButtons({ shift }) {
  const [run, busy] = useAction();
  const what = `${shiftLabel(shift)} ${formatEAT(shift.start_time, 'date')}`;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <a
        href={googleCalendarUrl(shift)}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ size: 'sm' })}
        aria-label={`Add ${what} to Google Calendar (opens Google)`}
      >
        <CalendarPlus aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">Google Calendar</span>
      </a>
      <Button
        size="sm"
        icon={Download}
        loading={busy}
        onClick={() => run(() => downloadIcs({ shift_id: shift.shift_id }))}
        aria-label={`Download ${what} as an .ics file`}
      >
        <span className="hidden sm:inline">.ics</span>
      </Button>
    </div>
  );
}

// "Download .ics" for the next 30 days (scope 'mine' or 'department').
export function Next30DaysButton({ scope = 'mine', label = 'Download .ics (next 30 days)' }) {
  const [run, busy] = useAction();
  return (
    <Button icon={Download} loading={busy} onClick={() => run(() => downloadIcs({ days: 30, scope }), 'Calendar file downloaded')}>
      {label}
    </Button>
  );
}
