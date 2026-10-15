import { useEffect } from 'react';
import { History, Square, Timer } from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, PageHeader, SkeletonTable, Table,
} from '../components/ui';
import { SessionNotice, StartShiftButton } from '../components/work/SessionControls';
import {
  fmtDuration, formatEAT, shiftLabel,
} from '../lib/format';
import { elapsedSince, fmtClock, useNow } from '../lib/live';
import { useWorkSession } from '../lib/workSession';
import useAction from '../lib/useAction';

const END_REASON = {
  manual: 'Ended by you',
  heartbeat: 'Timed out (app closed)',
  shift_end: 'Closed after the shift',
};

// My work (Part M5): start and end the shift, the running session and task
// timer, and the user's own session history with time per task.
export default function MyWorkPage() {
  const ws = useWorkSession();
  const now = useNow(1000, Boolean(ws.session));
  const [end, ending] = useAction();
  const { refresh } = ws;
  useEffect(() => { refresh(); }, [refresh]);

  const columns = [
    {
      key: 'when',
      header: 'Shift',
      render: (s) => (
        <div className="min-w-[10rem]">
          <div className="font-medium text-fg">{shiftLabel(s)} · {formatEAT(s.shift_start, 'date')}</div>
          <div className="text-meta text-ink-600">{formatEAT(s.started_at, 'time')} – {s.ended_at ? formatEAT(s.ended_at, 'time') : 'now'}</div>
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Session',
      render: (s) => <span className="tabular-nums">{s.ended_at ? fmtDuration(s.elapsed_ms) : fmtClock(elapsedSince(s.started_at, ws.offset, now))}</span>,
    },
    {
      key: 'end', header: 'Ended', hideBelow: 'md', render: (s) => (s.ended_at ? END_REASON[s.end_reason] : <Badge tone="green">Running</Badge>),
    },
    {
      key: 'tasks',
      header: 'Tasks timed',
      render: (s) => (s.tasks.length ? (
        <ul className="space-y-0.5">
          {s.tasks.map((t) => <li key={t.task_id} className="text-meta"><span className="tabular-nums">{fmtDuration(t.total_ms)}</span> · {t.description}</li>)}
        </ul>
      ) : <span className="text-ink-600">—</span>),
    },
  ];

  return (
    <>
      <PageHeader title="My work" subtitle="Your work sessions and the time you spent on each task. Times are Nairobi time (EAT)." />
      <SessionNotice className="mb-4" />
      <Card title="Current session" icon={Timer} className="mb-6">
        {!ws.loaded ? <SkeletonTable rows={1} /> : ws.session ? (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="text-title tabular-nums text-fg">{fmtClock(elapsedSince(ws.session.started_at, ws.offset, now))}</p>
              <p className="text-meta text-ink-600">
                Started {formatEAT(ws.session.started_at, 'time')} · {shiftLabel(ws.session)}, {ws.session.department_name}
              </p>
            </div>
            {ws.timer && (
              <div className="min-w-0">
                <p className="text-meta text-ink-600">Timing</p>
                <p className="font-medium text-fg">
                  {ws.timer.description} · <span className="tabular-nums">{fmtClock(elapsedSince(ws.timer.started_at, ws.offset, now))}</span>
                </p>
              </div>
            )}
            <Button icon={Square} loading={ending} onClick={() => end(() => ws.end(), 'Shift ended')} className="ml-auto">End shift</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-700">No session is running. Start your shift when you begin work.</p>
            <StartShiftButton />
          </div>
        )}
      </Card>
      <Card flush title="History" icon={History}>
        <Table
          loading={ws.history === null}
          columns={columns}
          rows={ws.history ?? []}
          rowKey={(s) => s.session_id}
          caption="Your work sessions"
          empty={<EmptyState icon={History} title="No sessions yet" message="Your sessions appear here once you start a shift." />}
        />
      </Card>
    </>
  );
}
