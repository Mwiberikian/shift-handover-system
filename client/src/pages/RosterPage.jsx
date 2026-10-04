import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Save, UserCog, Users } from 'lucide-react';
import api from '../api';
import {
  Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, SkeletonTable, Table,
} from '../components/ui';
import {
  ROLE_LABEL, fmtDuration, fmtNairobiDay, fmtNairobiTime, shiftLabel,
} from '../lib/format';
import { toastError } from '../lib/toast';
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

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Staff for ${shiftLabel(shift).toLowerCase()}`}
      description={`${shift.department_name} · ${fmtNairobiDay(shift.start_time)}, ${fmtNairobiTime(shift.start_time)} – ${fmtNairobiTime(shift.end_time)}`}
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
                  description={ROLE_LABEL[u.role]}
                  checked={chosen.has(u.user_id)}
                  onChange={() => toggle(u.user_id)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-meta text-ink-600">{chosen.size} selected</p>
        </fieldset>
      )}
    </Modal>
  );
}

export default function RosterPage() {
  const [shifts, setShifts] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => api.get('/shifts').then((r) => setShifts(r.data)).catch((err) => { toastError(err); setShifts([]); }), []);
  useEffect(() => { load(); }, [load]);

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
              {fmtNairobiDay(s.start_time)} · {fmtNairobiTime(s.start_time)} – {fmtNairobiTime(s.end_time)}
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
        <Button size="sm" icon={UserCog} onClick={() => setEditing(s)} aria-label={`Edit staff for ${shiftLabel(s)} ${fmtNairobiDay(s.start_time)}`}>
          <span className="hidden sm:inline">Edit staff</span>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Roster" subtitle="Who works each upcoming shift. Times are Nairobi time (EAT)." />
      <Card flush>
        {shifts === null ? <SkeletonTable rows={4} /> : (
          <Table
            columns={columns}
            rows={shifts}
            rowKey={(s) => s.shift_id}
            caption="Upcoming shifts and assigned staff"
            empty={<EmptyState icon={CalendarDays} title="No upcoming shifts" message="Shifts for the next seven days will appear here." />}
          />
        )}
      </Card>
      {editing && <AssignDialog shift={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}
