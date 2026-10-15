import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Clock, Timer } from 'lucide-react';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Badge, Card, Drawer, EmptyState, PageHeader, SegmentedPicker, Select, SkeletonTable, StatusBadge, Table,
} from '../components/ui';
import {
  cx, fmtDuration, fmtRelative, formatEAT, ROLE_LABEL, shiftLabel,
} from '../lib/format';
import {
  clockOffset, elapsedSince, fmtClock, useNow,
} from '../lib/live';
import { markSynced } from '../lib/refresh';
import { toastError } from '../lib/toast';
import usePolling from '../lib/usePolling';

// Supervisor live board (Part M4): who is working on the shift that is on
// now. Polls every 5 s while the tab is visible (usePolling); between polls
// the session and task timers tick here, from started_at and the server's
// clock (server_now), so they do not drift with the browser's clock.

export const STATE = {
  working: { label: 'Working', tone: 'green' },
  idle: { label: 'Idle', tone: 'amber' },
  not_started: { label: 'Not started', tone: 'gray' },
  ended: { label: 'Ended', tone: 'blue' },
  handover_submitted: { label: 'Handover submitted', tone: 'dark' },
};

// A running session or timer ticks; an ended one shows its final length.
export function sessionMs(session, offset, now) {
  if (!session) return null;
  return session.ended_at ? session.elapsed_ms : elapsedSince(session.started_at, offset, now);
}

function WorkerDetail({ userId, onClose }) {
  const [data, setData] = useState(null);
  const now = useNow(1000, Boolean(userId));
  usePolling(useCallback(() => {
    if (!userId) return;
    api.get(`/supervisor/live/${userId}`)
      .then((r) => setData({ ...r.data, offset: clockOffset(r.data.server_now) }))
      .catch(toastError);
  }, [userId]), 5000, Boolean(userId));

  const d = data?.worker.user_id === userId ? data : null;
  return (
    <Drawer open={Boolean(userId)} onClose={onClose} title={d ? `${d.worker.full_name} (${d.worker.staff_number})` : 'Worker'}>
      {!d ? <SkeletonTable rows={3} /> : (
        <div className="space-y-6">
          <p className="text-ink-600">
            {ROLE_LABEL[d.worker.role]} · {d.worker.department_name}
            {d.shift && <> · {shiftLabel(d.shift)}, {formatEAT(d.shift.start_time)} to {formatEAT(d.shift.end_time, 'time')}</>}
          </p>
          <section aria-labelledby="live-tasks">
            <h3 id="live-tasks" className="mb-2 text-section text-fg">Tasks worked on</h3>
            {d.tasks.length ? (
              <ul className="divide-y divide-ink-100">
                {d.tasks.map((t) => (
                  <li key={t.task_id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">{t.description}</span>
                    <StatusBadge kind="task" value={t.status} />
                    <span className="tabular-nums text-ink-700">
                      {t.running ? fmtClock(t.total_ms + elapsedSince(d.server_now, d.offset, now)) : fmtDuration(t.total_ms)}
                    </span>
                    {t.running && <Badge tone="green" icon={Timer}>Timing now</Badge>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-ink-600">No task has been timed on this shift.</p>}
          </section>
          <section aria-labelledby="live-timeline">
            <h3 id="live-timeline" className="mb-2 text-section text-fg">Timeline</h3>
            {d.timeline.length ? (
              <ol className="space-y-1.5 border-l border-ink-200 pl-4">
                {d.timeline.map((e, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="text-body">
                    <time dateTime={e.at} className="mr-2 tabular-nums text-ink-600">{formatEAT(e.at, 'time')}</time>
                    {e.label}
                  </li>
                ))}
              </ol>
            ) : <p className="text-ink-600">Nothing recorded on this shift yet.</p>}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function LivePage() {
  const { claims } = useAuth();
  const admin = claims.role === 'admin';
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('all');
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState(null);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get('/supervisor/live', { params: departmentId ? { department_id: departmentId } : {} });
      setOffset(clockOffset(d.server_now));
      setData(d);
      markSynced();
    } catch (err) {
      toastError(err);
    }
  }, [departmentId]);
  usePolling(load);
  // A new department loads at once rather than at the next poll.
  useEffect(() => { if (departmentId) load(); }, [departmentId, load]);

  const rows = useMemo(
    () => (data?.workers ?? []).filter((w) => filter === 'all' || w.state === filter),
    [data, filter],
  );

  const columns = [
    {
      key: 'name',
      header: 'Worker',
      render: (w) => (
        <div className="min-w-[10rem]">
          <div className="font-medium text-fg">{w.full_name}</div>
          <div className="text-meta text-ink-600">{ROLE_LABEL[w.role]} · {w.staff_number}</div>
        </div>
      ),
    },
    { key: 'state', header: 'State', render: (w) => <Badge tone={STATE[w.state].tone}>{STATE[w.state].label}</Badge> },
    {
      key: 'session',
      header: 'Session',
      render: (w) => {
        const t = sessionMs(w.session, offset, now);
        return t === null ? '—' : <span className="tabular-nums" aria-label={`Session ${fmtDuration(t)}`}>{fmtClock(t)}</span>;
      },
    },
    {
      key: 'task',
      header: 'Current task',
      render: (w) => (w.current_task ? (
        <div className="min-w-[10rem]">
          <div className="truncate">{w.current_task.description}</div>
          <div className="flex items-center gap-1 text-meta text-ink-600 tabular-nums">
            <Timer aria-hidden className="size-3.5" />
            {fmtClock(elapsedSince(w.current_task.timer_started_at, offset, now))}
          </div>
        </div>
      ) : <span className="text-ink-600">—</span>),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      hideBelow: 'md',
      render: (w) => <span className="whitespace-nowrap tabular-nums">{w.tasks.open} open · {w.tasks.in_progress} in progress · {w.tasks.resolved} resolved</span>,
    },
    { key: 'incident_count', header: 'Incidents', hideBelow: 'lg', className: 'tabular-nums' },
    {
      key: 'last', header: 'Last activity', hideBelow: 'lg', render: (w) => (w.last_activity_at ? fmtRelative(w.last_activity_at) : '—'),
    },
  ];

  const t = data?.totals;
  return (
    <>
      <PageHeader
        title="Live board"
        subtitle={data?.shift
          ? `${data.department.name} · ${shiftLabel(data.shift)}, ${formatEAT(data.shift.start_time)} to ${formatEAT(data.shift.end_time, 'time')}. Updates every 5 seconds.`
          : 'Who is working on the shift that is on now. Updates every 5 seconds.'}
        actions={admin && data?.departments ? (
          <Select
            label="Department"
            value={departmentId || data.department.department_id}
            onChange={(e) => { setDepartmentId(e.target.value); setData(null); }}
            options={data.departments.map((d) => ({ value: d.department_id, label: d.name }))}
            className="min-w-56"
          />
        ) : null}
      />
      {t && (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Department totals">
          {[
            ['On the roster', t.workers], ['Working', t.working], ['Idle', t.idle], ['Not started', t.not_started],
            ['Handover submitted', t.handover_submitted], ['Tasks open / in progress / resolved', `${t.open} / ${t.in_progress} / ${t.resolved}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-ink-200 bg-surface px-4 py-3 shadow-card">
              <dt className="text-meta text-ink-600">{label}</dt>
              <dd className="text-title tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <SegmentedPicker
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `All${t ? ` (${t.workers})` : ''}` },
          ...Object.entries(STATE).map(([value, s]) => ({ value, label: `${s.label}${t ? ` (${t[value]})` : ''}` })),
        ]}
        className="mb-4"
      />
      <Card flush>
        {!data ? <SkeletonTable /> : !data.shift ? (
          <EmptyState icon={Clock} title="No shift on now" message="There is no shift for this department at the moment." />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(w) => w.user_id}
            onRowClick={(w) => setSelected(w.user_id)}
            selectedKey={selected}
            rowLabel={(w) => `${w.full_name}, ${STATE[w.state].label}. Open details`}
            rowClassName={(w) => cx(w.state === 'idle' && 'bg-status-amber-soft/40')}
            caption="Workers on the current shift"
            empty={<EmptyState icon={Activity} title="No one here" message={filter === 'all' ? 'No one is rostered on this shift.' : 'No worker is in this state.'} />}
          />
        )}
      </Card>
      <p className="mt-3 text-meta text-ink-600">
        Idle means no heartbeat for {data?.idle_after_minutes ?? 2} minutes (the app sends one every minute while it is open).
        Only session and task times are tracked.
      </p>
      <WorkerDetail userId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
