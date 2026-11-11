import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import api from '../api';
import { Card } from './ui';
import { formatEAT, shiftLabel } from '../lib/format';

// "Who is on shift" (Phase 1): the current and next shift of the signed-in
// user's own department, names and staff numbers only. Renders nothing while
// loading, when the department has no shifts, or when the server answers 404
// (SUPERVISOR_CONTROLS_ENABLED=false) or any other error.
export default function WhoOnShift() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/shifts/department/current').then((r) => setData(r.data)).catch(() => setData(null));
  }, []);

  if (!data || (!data.current && !data.next)) return null;
  const blocks = [['On now', data.current], ['Next', data.next]].filter(([, s]) => s);
  return (
    <Card className="mb-6" icon={Users} title="Who is on shift" subtitle={data.current?.department_name ?? data.next?.department_name}>
      <div className="grid gap-4 sm:grid-cols-2">
        {blocks.map(([label, s]) => (
          <section key={label} aria-label={`${label}: ${shiftLabel(s)}`}>
            <h3 className="text-meta font-semibold tracking-wide text-ink-600 uppercase">
              {label} · {shiftLabel(s)}, {formatEAT(s.start_time, 'time')} – {formatEAT(s.end_time, 'time')}
            </h3>
            {s.assignees.length ? (
              <ul className="mt-1.5 space-y-1">
                {s.assignees.map((a) => (
                  <li key={`${a.staff_number}-${a.full_name}`} className="text-body text-fg">
                    {a.full_name} <span className="text-ink-600">· {a.staff_number}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-ink-600">Nobody assigned yet.</p>}
          </section>
        ))}
      </div>
    </Card>
  );
}
