import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, TimerReset } from 'lucide-react';
import api from '../../api';
import { Callout } from '../ui';
import { fmtDuration, fmtNairobiTime, shiftLabel } from '../../lib/format';

// Banner for the user's current or next rostered shift (from
// GET /shifts/mine), refreshed every minute so the countdown stays honest.
// Outgoing staff are told whether their handover is in; incoming staff see
// when they are on.
export default function ShiftBanner({ role }) {
  const [data, setData] = useState(null);
  const [, tick] = useState(0);

  const load = useCallback(() => api.get('/shifts/mine').then((r) => setData(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    const poll = setInterval(load, 60000);
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  if (!data) return null;
  const now = Date.now();
  const { current, next } = data;

  if (current) {
    const endsIn = new Date(current.end_time) - now;
    if (endsIn <= 0) return null; // the next minute's poll moves on to the next shift
    const ends = `${shiftLabel(current)} ends in ${fmtDuration(endsIn)} (${fmtNairobiTime(current.end_time)}).`;
    if (role === 'outgoing_staff') {
      const submitted = current.handover_status && current.handover_status !== 'draft';
      return submitted ? (
        <Callout tone="success" icon={CheckCircle2} className="mb-6" title={ends}>Handover submitted.</Callout>
      ) : (
        <Callout tone="warning" icon={TimerReset} className="mb-6" title={ends}>
          Handover not yet submitted{current.handover_status === 'draft' ? ' (a draft is in progress)' : ''}.
        </Callout>
      );
    }
    return <Callout tone="info" icon={Clock} className="mb-6" title={`On shift in ${current.department_name}.`}>{ends}</Callout>;
  }

  if (next) {
    const startsIn = new Date(next.start_time) - now;
    return (
      <Callout tone="info" icon={CalendarClock} className="mb-6" title={`Your next ${shiftLabel(next).toLowerCase()} starts in ${fmtDuration(startsIn)}.`}>
        {next.department_name}, {fmtNairobiTime(next.start_time)} – {fmtNairobiTime(next.end_time)}.
      </Callout>
    );
  }
  return null;
}
