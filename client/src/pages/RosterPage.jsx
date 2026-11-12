import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Save, UserCog, Users,
} from 'lucide-react';
import api from '../api';
import {
  Badge, Button, Callout, Card, Checkbox, EmptyState, Modal, PageHeader, SkeletonTable, Table,
} from '../components/ui';
import { ROLE_LABEL, fmtDuration, fmtWeekdayEAT, formatEAT, shiftLabel } from '../lib/format';
import { toastError } from '../lib/toast';
import { CalendarNote, Next30DaysButton, ShiftCalendarButtons } from '../components/CalendarButtons';
import useAction from '../lib/useAction';

// Staff multi-select for one shift (checkbox list: Tab/Space operable).
function AssignDialog({ shift, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [run, busy] = useAction();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Load once per shift (onClose is a fresh function on every parent render).
  useEffect(() => {
    api.get(`/shifts/${shift.shift_id}/assignments`)
      .then((r) => { setData(r.data); setChosen(new Set(r.data.assigned.map((u) => u.user_id))); })
      .catch((err) => { toastError(err); closeRef.current(); });
  }, [shift.shift_id]);

  const toggle = (id) => setChosen((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    const ok = await run(() => api.put(`/shifts/${shift.shift_id}/assignments`, { user_ids: [...chosen] }), 'Roster updated');
    if (ok) { onSaved(); onClose(); }
  };

  // Phase 3 conflict warnings: people already assigned to a shift that
  // overlaps this one in time. Advisory — saving is never blocked.
  const conflictsByUser = new Map();
  (data?.conflicts ?? []).forEach((c) => {
    if (!conflictsByUser.has(c.user_id)) conflictsByUser.set(c.user_id, []);
    conflictsByUser.get(c.user_id).push(c);
  });
  const chosenConflicts = [...chosen].filter((id) => conflictsByUser.has(id));
  const conflictText = (c) => `${shiftLabel(c)} ${formatEAT(c.start_time, 'date')}, ${formatEAT(c.start_time, 'time')} – ${formatEAT(c.end_time, 'time')}`;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Staff for ${shiftLabel(shift).toLowerCase()}`}
      description={`${shift.department_name} · ${fmtWeekdayEAT(shift.start_time)} ${formatEAT(shift.start_time, 'date')}, ${formatEAT(shift.start_time, 'time')} – ${formatEAT(shift.end_time, 'time')}`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={busy} disabled={!data} onClick={save}>Save roster</Button>
        </>
      )}
    >
      {!data ? <SkeletonTable rows={4} cols={2} /> : data.candidates.length === 0 ? (
        <EmptyState compact icon={Users} title="No active staff in this department" />
      ) : (
        <fieldset>
          <legend className="mb-3 text-sm text-ink-700">
            Assigned staff get a reminder before the shift starts; outgoing staff also get handover-due reminders.
          </legend>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {data.candidates.map((u) => (
              <li key={u.user_id} className="rounded-lg px-2 py-2 hover:bg-ink-50">
                <Checkbox
                  label={u.full_name}
                  description={conflictsByUser.has(u.user_id)
                    ? `${ROLE_LABEL[u.role]} — also on an overlapping shift`
                    : ROLE_LABEL[u.role]}
                  checked={chosen.has(u.user_id)}
                  onChange={() => toggle(u.user_id)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-meta text-ink-600">{chosen.size} selected</p>
          {chosenConflicts.length > 0 && (
            <Callout tone="warning" className="mt-3" title="Overlapping shifts">
              <ul className="list-disc space-y-0.5 pl-5">
                {chosenConflicts.map((id) => {
                  const who = data.candidates.find((u) => u.user_id === id);
                  return conflictsByUser.get(id).map((c) => (
                    <li key={`${id}-${c.shift_id}`}>
                      {who?.full_name ?? 'This person'} is also assigned to {conflictText(c)}.
                    </li>
                  ));
                })}
              </ul>
              <p className="mt-1.5">You can still save — this is a warning, not a block.</p>
            </Callout>
          )}
        </fieldset>
      )}
    </Modal>
  );
}

// Phase 1 roster visibility: the page lists shifts by day, a week at a time.
// Monday 00:00 Nairobi time (EAT is UTC+3, no daylight saving) of the week
// `offset` weeks away from the one containing `d`.
export function weekStartEAT(d = new Date(), offset = 0) {
  const eat = new Date(d.getTime() + 3 * 3600e3);
  const day = (eat.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() - day + offset * 7) - 3 * 3600e3);
}

const DAY_MS = 24 * 3600e3;

export default function RosterPage() {
  const [shifts, setShifts] = useState(null);
  const [editing, setEditing] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => weekStartEAT(new Date(), weekOffset), [weekOffset]);
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart]);

  const load = useCallback(() => api.get('/shifts', { params: { from: weekStart.toISOString(), to: weekEnd.toISOString() } })
    .then((r) => setShifts(r.data))
    .catch((err) => { toastError(err); setShifts([]); }), [weekStart, weekEnd]);
  useEffect(() => { setShifts(null); load(); }, [load]);

  // Shifts grouped by the EAT day they start on, in week order.
  const days = useMemo(() => {
    const by = new Map();
    for (const s of shifts ?? []) {
      const key = `${fmtWeekdayEAT(s.start_time)} ${formatEAT(s.start_time, 'date')}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(s);
    }
    return [...by.entries()];
  }, [shifts]);

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
      key: 'assigned',
      header: 'Assigned staff',
      render: (s) => (s.assigned.length ? (
        <div className="flex flex-wrap gap-1.5">
          {s.assigned.map((u) => <Badge key={u.user_id} tone="gray">{u.full_name}</Badge>)}
        </div>
      ) : <span className="text-ink-600">Nobody assigned</span>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (s) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <ShiftCalendarButtons shift={s} />
          <Button size="sm" icon={UserCog} onClick={() => setEditing(s)} aria-label={`Edit staff for ${shiftLabel(s)} ${formatEAT(s.start_time, 'date')}`}>
            <span className="hidden sm:inline">Edit staff</span>
          </Button>
        </div>
      ),
    },
  ];

  const weekLabel = weekOffset === 0 ? 'This week'
    : `Week of ${formatEAT(weekStart, 'date')}`;
  return (
    <>
      <PageHeader
        title="Roster"
        subtitle={`Shifts by day, ${formatEAT(weekStart, 'date')} – ${formatEAT(new Date(weekEnd.getTime() - DAY_MS), 'date')}. Times are Nairobi time (EAT).`}
        actions={<Next30DaysButton scope="department" label="Download roster .ics (30 days)" />}
      />
      <nav aria-label="Week" className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={ChevronLeft} onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">Previous</Button>
        <Button size="sm" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>This week</Button>
        <Button size="sm" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
          Next
          <ChevronRight aria-hidden className="size-3.5" />
        </Button>
        <span className="text-meta text-ink-600" aria-live="polite">{weekLabel}</span>
      </nav>
      {shifts === null ? <Card flush><SkeletonTable rows={4} /></Card> : days.length === 0 ? (
        <Card flush>
          <EmptyState icon={CalendarDays} title="No shifts this week" message="Use Previous and Next to look at other weeks." />
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map(([day, rows]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 text-section text-fg">{day}</h2>
              <Card flush>
                <Table
                  columns={columns}
                  rows={rows}
                  rowKey={(s) => s.shift_id}
                  caption={`Shifts and assigned staff on ${day}`}
                />
              </Card>
            </section>
          ))}
        </div>
      )}
      <CalendarNote className="mt-3" />
      {editing && <AssignDialog shift={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}
