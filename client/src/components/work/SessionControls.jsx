import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Pause, Play, Square, Timer,
} from 'lucide-react';
import { Button, Modal } from '../ui';
import { cx } from '../../lib/format';
import { elapsedSince, fmtClock, useNow } from '../../lib/live';
import {
  SESSION_NOTICE, markNoticeSeen, noticeSeen, useWorkSession,
} from '../../lib/workSession';
import useAction from '../../lib/useAction';

// The notice, as one block (first use, the My work page, Help).
export function SessionNotice({ className }) {
  return (
    <p className={cx('rounded-lg border border-status-blue-line bg-status-blue-soft px-3 py-2 text-status-blue', className)}>
      {SESSION_NOTICE}
    </p>
  );
}

// "Start shift": the first time, the notice is shown and must be accepted.
export function StartShiftButton({ className, compact = false }) {
  const ws = useWorkSession();
  const [asking, setAsking] = useState(false);
  const [run, busy] = useAction();
  const go = () => run(async () => {
    markNoticeSeen();
    setAsking(false);
    await ws.start();
  });
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        icon={Play}
        loading={busy}
        className={className}
        onClick={() => (noticeSeen() ? go() : setAsking(true))}
        aria-label={compact ? 'Start shift' : undefined}
      >
        <span className={compact ? 'hidden sm:inline' : undefined}>Start shift</span>
      </Button>
      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Before you start"
        footer={(
          <>
            <Button onClick={() => setAsking(false)}>Not now</Button>
            <Button variant="primary" icon={Play} onClick={go} loading={busy}>Start shift</Button>
          </>
        )}
      >
        <SessionNotice />
        <p className="mt-3 text-ink-700">
          Starting your shift records when you started. Keep the app open: it tells the server you are still working once a
          minute, and your session ends by itself 10 minutes after the app was last open. You can also time each task.
        </p>
      </Modal>
    </>
  );
}

// Header: Start shift, or the running session clock (a link to My work) and End shift.
export function HeaderSessionControl() {
  const ws = useWorkSession();
  const now = useNow(1000, Boolean(ws.session));
  const [run, busy] = useAction();
  if (!ws.enabled || !ws.loaded) return null;
  if (!ws.session) return <StartShiftButton compact />;
  const elapsed = elapsedSince(ws.session.started_at, ws.offset, now);
  return (
    <div className="flex items-center gap-1">
      <Link
        to="/work"
        className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-white tabular-nums hover:bg-white/10"
        aria-label={`On shift for ${fmtClock(elapsed)}. Open My work`}
      >
        <Timer aria-hidden className="size-4 text-status-green-line" />
        <span className="hidden min-[400px]:inline">{fmtClock(elapsed)}</span>
      </Link>
      <button
        type="button"
        onClick={() => run(() => ws.end())}
        disabled={busy}
        className="hidden h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white sm:inline-flex"
      >
        <Square aria-hidden className="size-3.5" />
        <span className="sr-only lg:not-sr-only">End shift</span>
      </button>
    </div>
  );
}

// Start/stop timer for one task on the user's draft handover.
export function TaskTimerButton({ task }) {
  const ws = useWorkSession();
  const running = ws.timer?.task_id === task.task_id;
  const now = useNow(1000, running);
  const [run, busy] = useAction();
  if (!ws.enabled) return null;
  if (!ws.session) {
    return (
      <Button size="sm" icon={Play} disabled aria-label={`Time “${task.description}” (start your shift first)`} title="Start your shift first">
        <span className="hidden sm:inline">Timer</span>
      </Button>
    );
  }
  return running ? (
    <Button
      size="sm"
      variant="primary"
      icon={Pause}
      loading={busy}
      onClick={() => run(() => ws.stopTimer(task.task_id))}
      aria-label={`Stop timing “${task.description}”, ${fmtClock(elapsedSince(ws.timer.started_at, ws.offset, now))} so far`}
    >
      <span className="tabular-nums">{fmtClock(elapsedSince(ws.timer.started_at, ws.offset, now))}</span>
    </Button>
  ) : (
    <Button size="sm" icon={Play} loading={busy} onClick={() => run(() => ws.startTimer(task.task_id))} aria-label={`Start timing “${task.description}”`}>
      <span className="hidden sm:inline">Timer</span>
    </Button>
  );
}
