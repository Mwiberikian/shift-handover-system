import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import api from '../api';
import {
  Badge, Card, EmptyState, PageHeader, SkeletonTable, Table,
} from '../components/ui';
import { CalendarNote, Next30DaysButton, ShiftCalendarButtons } from '../components/CalendarButtons';
import { fmtDuration, fmtWeekdayEAT, formatEAT, shiftLabel } from '../lib/format';
import { toastError } from '../lib/toast';

// The signed-in user's rostered shifts for the next 30 days, each with
// "Add to Google Calendar" and "Download .ics".
export default function MyShiftsPage() {
  const [shifts, setShifts] = useState(null);
  useEffect(() => {
    api.get('/shifts/mine/upcoming', { params: { days: 30 } })
      .then((r) => setShifts(r.data))
      .catch((err) => { toastError(err); setShifts([]); });
  }, []);

  const now = Date.now();
  const columns = [
    {
      key: 'shift',
      header: 'Shift',
      render: (s) => {
        const live = new Date(s.start_time) <= now && new Date(s.end_time) > now;
        return (
          <div className="min-w-[10rem]">
            <div className="flex items-center gap-2 font-medium text-fg">
              {shiftLabel(s)}
              {live && <Badge tone="green">Now</Badge>}
            </div>
            <div className="text-meta text-ink-600">
              {fmtWeekdayEAT(s.start_time)} {formatEAT(s.start_time, 'date')} · {formatEAT(s.start_time, 'time')} – {formatEAT(s.end_time, 'time')}
            </div>
          </div>
        );
      },
    },
    { key: 'department_name', header: 'Department', hideBelow: 'md' },
    {
      key: 'starts',
      header: 'Starts',
      hideBelow: 'lg',
      render: (s) => <span className="text-ink-700">{new Date(s.start_time) > now ? `in ${fmtDuration(new Date(s.start_time) - now)}` : 'Started'}</span>,
    },
    {
      key: 'calendar',
      header: <span className="sr-only">Add to calendar</span>,
      className: 'text-right',
      render: (s) => <ShiftCalendarButtons shift={s} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="My shifts"
        subtitle="Your rostered shifts for the next 30 days. Times are Nairobi time (EAT)."
        actions={shifts?.length ? <Next30DaysButton /> : null}
      />
      <Card flush>
        {shifts === null ? <SkeletonTable rows={3} /> : shifts.length === 0
          ? <EmptyState icon={CalendarClock} title="No shifts rostered" message="Your supervisor has not rostered you on any shift in the next 30 days." />
          : <Table columns={columns} rows={shifts} rowKey={(s) => s.shift_id} caption="Your rostered shifts" />}
      </Card>
      <CalendarNote className="mt-3" />
    </>
  );
}
