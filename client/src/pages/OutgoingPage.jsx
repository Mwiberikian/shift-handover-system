import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarOff, CheckCircle2, Circle, ClipboardList, ClipboardPlus, Clock, Lock, MessageSquareReply,
  Plus, Save, Send,
} from 'lucide-react';
import api from '../api';
import {
  HandoverDetail, IncidentTable, RecordTable, TaskTable,
} from '../components/Handover';
import {
  Button, Callout, Card, ConfirmDialog, Drawer, EmptyState, Input, PageHeader, PRIORITY_OPTIONS,
  SegmentedPicker, Select, SEVERITY_OPTIONS, SkeletonCard, StatusBadge, Textarea,
} from '../components/ui';
import {
  cx, fmt, fmtTime, shiftLabel,
} from '../lib/format';
import { toast, toastError } from '../lib/toast';
import useAction from '../lib/useAction';

// Requirement list for the department template, evaluated against what the
// user currently sees (including unsaved edits).
function requirementsFor(template, record, notes, incoming) {
  const counts = { tasks: record.tasks.length, incidents: record.incidents.length };
  const items = template.field_definition.fields.map((f) => {
    if (f.key === 'summary_notes') {
      const len = notes.trim().length;
      const min = Math.max(1, f.minLength || 0);
      return {
        key: f.key, label: f.label, required: !!f.required, ok: !f.required || len >= min,
        hint: f.minLength ? `${len} / ${f.minLength} characters` : (len ? 'Written' : 'Not written yet'),
      };
    }
    const min = f.minItems ?? 1;
    return {
      key: f.key, label: f.label, required: !!f.required, ok: !f.required || counts[f.key] >= min,
      hint: `${counts[f.key]} added${f.required ? ` · ${min} required` : ''}`,
    };
  });
  items.push({ key: 'incoming', label: 'Incoming staff member assigned', required: true, ok: !!incoming, hint: incoming ? 'Assigned' : 'Not assigned yet' });
  const required = items.filter((i) => i.required);
  return { items, done: required.filter((i) => i.ok).length, total: required.length };
}

function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="Mandatory requirements completed"
      className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', done === total ? 'bg-status-green' : 'bg-brand-red')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Checklist({ items }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2.5">
          {i.ok
            ? <CheckCircle2 aria-hidden className="mt-px size-[18px] shrink-0 text-status-green" />
            : <Circle aria-hidden className="mt-px size-[18px] shrink-0 text-zinc-400" />}
          <div className="min-w-0">
            <p className={cx('leading-tight', i.ok ? 'text-zinc-700' : 'font-medium text-brand-black')}>
              {i.label}
              {!i.required && <span className="ml-1 text-meta font-normal text-zinc-500">(optional)</span>}
              <span className="sr-only">{i.ok ? ' — complete' : ' — incomplete'}</span>
            </p>
            <p className="mt-0.5 text-meta text-zinc-600">{i.hint}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SectionLabel({ required }) {
  return required
    ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-meta font-medium text-zinc-700">Required</span>
    : <span className="text-meta text-zinc-500">Optional</span>;
}

function DraftEditor({ record, meta, reload }) {
  const [notes, setNotes] = useState(record.summary_notes || '');
  const [incoming, setIncoming] = useState(record.incoming_user_id || '');
  const [task, setTask] = useState({ description: '', priority: 'medium' });
  const [incident, setIncident] = useState({ title: '', description: '', severity: 'low', occurred_at: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [save, saving] = useAction();
  const [addT, addingTask] = useAction();
  const [addI, addingIncident] = useAction();
  const [submitRun, submitting] = useAction();
  const [statusRun] = useAction();

  const fields = Object.fromEntries(meta.template.field_definition.fields.map((f) => [f.key, f]));
  const req = requirementsFor(meta.template, record, notes, incoming);
  const ready = req.done === req.total;
  const missing = req.items.filter((i) => i.required && !i.ok);
  const dirty = notes !== (record.summary_notes || '') || incoming !== (record.incoming_user_id || '');

  const saveDraft = () => save(async () => {
    await api.patch(`/handovers/${record.record_id}`, { summary_notes: notes, incoming_user_id: incoming || null });
    await reload();
  }, 'Draft saved');

  const addTask = (e) => {
    e.preventDefault();
    addT(async () => {
      await api.post(`/handovers/${record.record_id}/tasks`, task);
      setTask({ description: '', priority: 'medium' });
      await reload();
    }, 'Task added');
  };

  const addIncident = (e) => {
    e.preventDefault();
    addI(async () => {
      await api.post(`/handovers/${record.record_id}/incidents`, {
        ...incident, occurred_at: new Date(incident.occurred_at).toISOString(),
      });
      setIncident({ title: '', description: '', severity: 'low', occurred_at: '' });
      await reload();
    }, 'Incident logged');
  };

  const setTaskStatus = (t, status) => statusRun(async () => {
    await api.patch(`/handovers/${record.record_id}/tasks/${t.task_id}`, { status });
    await reload();
  });

  const submit = async () => {
    const ok = await submitRun(async () => {
      // Save unsaved form edits first so the server validates what the user sees.
      await api.patch(`/handovers/${record.record_id}`, { summary_notes: notes, incoming_user_id: incoming || null });
      const { data } = await api.post(`/handovers/${record.record_id}/submit`);
      toast.success('Handover submitted and locked', {
        description: `${data.carried_forward} task(s) carried forward from the previous shift; ${data.notified.length} people notified.`,
        duration: 8000,
      });
    });
    setConfirmOpen(false);
    if (ok) reload();
  };

  const summaryField = fields.summary_notes;
  const notesLen = notes.trim().length;
  const incomingName = meta.incoming_staff.find((u) => u.user_id === incoming)?.full_name;

  const submitPanel = (
    <>
      <Button variant="primary" size="lg" icon={Send} className="w-full" disabled={!ready} onClick={() => setConfirmOpen(true)} aria-describedby="submit-help">
        Submit handover
      </Button>
      <p id="submit-help" className="mt-2 text-meta text-zinc-600">
        {ready
          ? 'Submitting locks the record. It cannot be edited afterwards.'
          : `Complete ${missing.length} more requirement${missing.length === 1 ? '' : 's'} to submit: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`}
      </p>
    </>
  );

  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_20rem] lg:pb-0">
      <div className="space-y-6">
        <Card
          title="Handover details"
          icon={ClipboardList}
          actions={(
            <>
              {dirty && <span className="text-meta font-medium text-status-amber">Unsaved changes</span>}
              <Button size="sm" icon={Save} onClick={saveDraft} loading={saving} disabled={!dirty}>Save draft</Button>
            </>
          )}
        >
          <div className="space-y-5">
            <Select
              label="Incoming staff member"
              required
              value={incoming}
              onChange={(e) => setIncoming(e.target.value)}
              placeholder="Select who takes over…"
              options={meta.incoming_staff.map((u) => ({ value: u.user_id, label: `${u.full_name} (${u.staff_number})` }))}
              hint="They will be notified when you submit."
            />
            <Textarea
              label={summaryField?.label ?? 'Summary notes'}
              required={!!summaryField?.required}
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does the next shift need to know?"
              hint={summaryField?.minLength
                ? `${notesLen} / ${summaryField.minLength} characters minimum${notesLen >= summaryField.minLength ? ' ✓' : ''}`
                : undefined}
            />
          </div>
        </Card>

        <Card
          title={fields.tasks?.label ?? 'Tasks'}
          subtitle={`${record.tasks.length} task${record.tasks.length === 1 ? '' : 's'}`}
          icon={ClipboardList}
          actions={<SectionLabel required={fields.tasks?.required} />}
        >
          <TaskTable
            tasks={record.tasks}
            actions={(t) => (
              <Select
                label={`Status for “${t.description}”`}
                hideLabel
                value={t.status}
                onChange={(e) => setTaskStatus(t, e.target.value)}
                className="w-40"
                options={[{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }]}
              />
            )}
          />
          <form onSubmit={addTask} className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 p-3 sm:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <Input
                label="New task"
                className="flex-1"
                placeholder="Describe the task to hand over"
                value={task.description}
                onChange={(e) => setTask({ ...task, description: e.target.value })}
                required
              />
              <SegmentedPicker label="Priority" value={task.priority} onChange={(priority) => setTask({ ...task, priority })} options={PRIORITY_OPTIONS} />
              <Button type="submit" icon={Plus} loading={addingTask}>Add task</Button>
            </div>
          </form>
        </Card>

        <Card
          title={fields.incidents?.label ?? 'Incidents'}
          subtitle={`${record.incidents.length} logged`}
          icon={AlertTriangle}
          actions={<SectionLabel required={fields.incidents?.required} />}
        >
          <IncidentTable incidents={record.incidents} />
          <form onSubmit={addIncident} className="mt-4 space-y-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 p-3 sm:p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
              <Input label="Incident title" placeholder="Short headline" value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} required />
              <Input label="Occurred at" type="datetime-local" value={incident.occurred_at} onChange={(e) => setIncident({ ...incident, occurred_at: e.target.value })} required />
            </div>
            <Textarea label="Description" rows={2} placeholder="What happened, and any follow-up (optional)" value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SegmentedPicker label="Severity" value={incident.severity} onChange={(severity) => setIncident({ ...incident, severity })} options={SEVERITY_OPTIONS} />
              <Button type="submit" icon={Plus} loading={addingIncident}>Log incident</Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Desktop: sticky readiness panel. */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
          <Card title="Ready to submit?" subtitle={`${record.department_code?.toUpperCase()} template v${meta.template.version}`}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-semibold text-brand-black">{req.done} of {req.total}</span>
              <span className="text-meta text-zinc-600">mandatory items complete</span>
            </div>
            <ProgressBar done={req.done} total={req.total} />
            <div className="mt-5"><Checklist items={req.items} /></div>
            <div className="mt-6 border-t border-zinc-200 pt-4">{submitPanel}</div>
          </Card>
        </div>
      </aside>

      {/* Mobile/tablet: checklist inline, submit pinned to the bottom. */}
      <Card title="Requirements" className="lg:hidden">
        <Checklist items={req.items} />
      </Card>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.05)] backdrop-blur md:left-16 lg:hidden">
        <div className="mb-2 flex items-center gap-3">
          <span className="shrink-0 text-meta font-semibold text-brand-black">{req.done}/{req.total} complete</span>
          <ProgressBar done={req.done} total={req.total} />
        </div>
        {submitPanel}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        loading={submitting}
        icon={Lock}
        title="Submit and lock this handover?"
        confirmLabel="Submit handover"
        message={(
          <p>
            The record will be locked and sent to <strong className="text-brand-black">{incomingName ?? 'the incoming staff member'}</strong> for
            acknowledgement. You won&apos;t be able to edit it afterwards.
          </p>
        )}
      />
    </div>
  );
}

function ClarifyBox({ record, reload }) {
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const send = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post(`/handovers/${record.record_id}/clarify`, { comments: text });
      setText('');
      await reload();
    }, 'Clarification sent');
  };
  return (
    <Card flush className="overflow-hidden border-status-amber-line">
      <form onSubmit={send} className="border-l-4 border-l-status-amber p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareReply aria-hidden className="size-[18px] text-status-amber" />
          <h2 className="text-section text-brand-black">{record.incoming_name ?? 'The incoming staff member'} raised a query</h2>
          <StatusBadge value="queried" />
        </div>
        <p className="mt-1 text-meta text-zinc-600">{shiftLabel(record)} · {fmt(record.shift_start)}</p>
        <blockquote className="mt-3 rounded-lg bg-status-amber-soft px-4 py-3 whitespace-pre-wrap text-zinc-800">
          {record.acknowledgement?.comments}
        </blockquote>
        <Textarea className="mt-4" label="Your clarification" required rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary" icon={Send} loading={busy}>Send clarification</Button>
        </div>
      </form>
    </Card>
  );
}

// Fetches a queried record's detail so the clarify box can show the query text.
function QueriedLoader({ id, reload }) {
  const [record, setRecord] = useState(null);
  useEffect(() => { api.get(`/handovers/${id}`).then((r) => setRecord(r.data)).catch(toastError); }, [id]);
  return record ? <ClarifyBox record={record} reload={reload} /> : <SkeletonCard lines={3} />;
}

function CurrentView({ meta, records, current, reload }) {
  const [start, starting] = useAction();
  const queried = records.filter((r) => r.status === 'queried');
  const shift = meta.current_shift;

  return (
    <div className="space-y-6">
      {queried.map((r) => <QueriedLoader key={r.record_id} id={r.record_id} reload={reload} />)}

      {shift && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-card sm:px-5">
          <div className="flex items-center gap-2">
            <Clock aria-hidden className="size-4 text-zinc-500" />
            <span className="font-semibold text-brand-black">{shiftLabel(shift)}</span>
          </div>
          <span className="text-zinc-700">{fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}</span>
          <span className="text-meta text-zinc-600">{fmt(shift.start_time)}</span>
          {current && <StatusBadge value={current.status} className="ml-auto" />}
        </div>
      )}

      {!shift && (
        <Card>
          <EmptyState
            icon={CalendarOff}
            title="No active shift"
            message="There is no shift currently running for your department, so there is nothing to hand over yet."
          />
        </Card>
      )}

      {shift && !current && (
        <Card>
          <EmptyState
            icon={ClipboardPlus}
            title="No handover started"
            message={`Start the handover for the current ${shift.shift_type} shift. You can save it as a draft and come back to it.`}
            action={(
              <Button variant="primary" icon={Plus} loading={starting} onClick={() => start(async () => { await api.post('/handovers', {}); await reload(); }, 'Draft handover created')}>
                Start handover
              </Button>
            )}
          />
        </Card>
      )}

      {current?.status === 'draft' && <DraftEditor key={current.record_id} record={current} meta={meta} reload={reload} />}

      {current && current.status !== 'draft' && (
        <>
          {current.status === 'submitted' && (
            <Callout tone="info" title="Submitted — awaiting acknowledgement">
              {current.incoming_name ?? 'The incoming staff member'} has been notified. The record is locked.
            </Callout>
          )}
          <Card><HandoverDetail record={current} /></Card>
        </>
      )}
    </div>
  );
}

function HistoryView({ records }) {
  const [selected, setSelected] = useState(null);
  const open = async (id) => {
    try {
      setSelected((await api.get(`/handovers/${id}`)).data);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <>
      <Card flush>
        <RecordTable records={records} onSelect={open} selectedId={selected?.record_id} empty="You haven't prepared any handovers yet." />
      </Card>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Handover record">
        {selected && <HandoverDetail record={selected} />}
      </Drawer>
    </>
  );
}

export default function OutgoingPage({ view }) {
  const [meta, setMeta] = useState(null);
  const [records, setRecords] = useState([]);
  const [current, setCurrent] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([api.get('/handovers/meta'), api.get('/handovers')]);
      const active = list.data.find((r) => r.shift_id === m.data.current_shift?.shift_id && r.status !== 'closed');
      const detail = active ? (await api.get(`/handovers/${active.record_id}`)).data : null;
      setMeta(m.data);
      setRecords(list.data);
      setCurrent(detail);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <PageHeader
        title={view === 'history' ? 'My handovers' : 'Current handover'}
        subtitle={view === 'history' ? 'Every handover you have prepared, newest first.' : 'Prepare and submit the handover for your current shift.'}
      />
      {!meta ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6"><SkeletonCard lines={5} /><SkeletonCard lines={3} /></div>
          <SkeletonCard lines={6} className="hidden lg:block" />
        </div>
      ) : view === 'history'
        ? <HistoryView records={records} />
        : <CurrentView meta={meta} records={records} current={current} reload={reload} />}
    </>
  );
}
