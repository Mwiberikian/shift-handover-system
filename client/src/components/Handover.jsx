// Shared, read-only building blocks for displaying handover records.
import {
  AlertTriangle, CheckCircle2, ClipboardList, CornerDownRight, FileText, HelpCircle, History, MessageSquareReply,
  ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { cx, fmt, fmtRelative, shiftLabel } from '../lib/format';
import { Callout, EmptyState, StatusBadge, Table } from './ui';

export { fmt };
export { StatusBadge };

// Interim inline error, kept for screens not yet moved to toasts.
export function ErrorBox({ error }) {
  if (!error) return null;
  const [title, ...rest] = error.split('\n');
  return <Callout tone="danger" title={title} className="mb-4">{rest.length > 0 && <div className="whitespace-pre-line">{rest.join('\n')}</div>}</Callout>;
}

export const RECORD_COLUMNS = [
  {
    key: 'shift',
    header: 'Shift',
    render: (r) => (
      <div className="min-w-[9rem]">
        <div className="font-medium text-brand-black">{shiftLabel(r)}</div>
        <div className="text-meta text-zinc-600">{fmt(r.shift_start)}</div>
      </div>
    ),
  },
  { key: 'department_code', header: 'Dept', hideBelow: 'md', render: (r) => <span className="font-mono text-meta text-zinc-700 uppercase">{r.department_code}</span> },
  { key: 'outgoing_name', header: 'Outgoing', hideBelow: 'lg', render: (r) => r.outgoing_name ?? '—' },
  { key: 'incoming_name', header: 'Incoming', hideBelow: 'sm', render: (r) => r.incoming_name ?? <span className="text-zinc-500">Unassigned</span> },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  { key: 'submitted_at', header: 'Submitted', hideBelow: 'md', render: (r) => <span className="text-zinc-700 whitespace-nowrap">{fmt(r.submitted_at)}</span> },
];

export function RecordTable({ records, onSelect, selectedId, empty = 'No records.', loading, columns = RECORD_COLUMNS, rowClassName }) {
  return (
    <Table
      columns={columns}
      rows={records}
      rowKey={(r) => r.record_id}
      onRowClick={onSelect ? (r) => onSelect(r.record_id) : undefined}
      rowLabel={(r) => `${shiftLabel(r)} ${fmt(r.shift_start)}, ${r.status}`}
      selectedKey={selectedId}
      loading={loading}
      rowClassName={rowClassName}
      empty={<EmptyState compact icon={FileText} title={empty} />}
    />
  );
}

export function CarriedTag({ fromRecord }) {
  return (
    <span
      title={fromRecord ? `Carried forward from record ${fromRecord.slice(0, 8)}` : 'Carried forward from the previous shift'}
      className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-meta font-medium whitespace-nowrap text-white"
    >
      <CornerDownRight aria-hidden className="size-3" /> Carried forward
    </span>
  );
}

// Tasks as a stacked list (reads better than a table on narrow screens).
// `actions(task)` renders an optional control on the right of each row.
export function TaskTable({ tasks, actions }) {
  if (!tasks.length) return <EmptyState compact icon={ClipboardList} title="No tasks" message="No tasks were recorded for this shift." />;
  return (
    <ul className="divide-y divide-zinc-100">
      {tasks.map((t) => (
        <li
          key={t.task_id}
          className={cx('flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4', t.carried_from_task_id && 'border-l-2 border-l-zinc-800 pl-3 -ml-px')}
        >
          <div className="min-w-0 flex-1">
            <p className="text-brand-black">{t.description}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge kind="priority" value={t.priority} />
              {!actions && <StatusBadge kind="task" value={t.status} />}
              {t.carried_from_task_id && <CarriedTag fromRecord={t.carried_from_record_id} />}
            </div>
          </div>
          {actions && <div className="shrink-0">{actions(t)}</div>}
        </li>
      ))}
    </ul>
  );
}

export function IncidentTable({ incidents }) {
  if (!incidents.length) return <EmptyState compact icon={ShieldCheck} title="No incidents" message="No incidents were reported during this shift." />;
  return (
    <ul className="divide-y divide-zinc-100">
      {incidents.map((i) => (
        <li key={i.incident_id} className="flex flex-col gap-1.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="severity" value={i.severity} />
            <p className="font-medium text-brand-black">{i.title}</p>
          </div>
          {i.description && <p className="text-zinc-700">{i.description}</p>}
          <p className="text-meta text-zinc-600">
            Occurred {fmt(i.occurred_at)}{i.reported_by_name && ` · Reported by ${i.reported_by_name}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

const THREAD = {
  query: ['Query raised', HelpCircle, 'text-status-amber bg-status-amber-soft'],
  clarify: ['Clarification', MessageSquareReply, 'text-status-blue bg-status-blue-soft'],
  acknowledge: ['Acknowledged', CheckCircle2, 'text-status-green bg-status-green-soft'],
  review: ['Supervisor review', ShieldCheck, 'text-zinc-700 bg-zinc-100'],
  resolve: ['Escalation resolved', ShieldAlert, 'text-status-green bg-status-green-soft'],
};

export function Timeline({ items }) {
  return (
    <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-zinc-200">
      {items.map((t, i) => {
        const [label, Icon, tone] = THREAD[t.action] ?? [t.action, History, 'text-zinc-700 bg-zinc-100'];
        return (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i} className="relative flex gap-3">
            <span className={cx('z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-white', tone)}>
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 pt-1">
              <p>
                <span className="font-medium text-brand-black">{label}</span>
                <span className="text-zinc-600"> by {t.by_name}</span>
              </p>
              <p className="text-meta text-zinc-600" title={fmt(t.logged_at)}>{fmtRelative(t.logged_at)} · {fmt(t.logged_at)}</p>
              {t.comments && <p className="mt-1.5 rounded-lg bg-zinc-50 px-3 py-2 whitespace-pre-wrap text-zinc-800">{t.comments}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, count, icon: Icon, children }) {
  return (
    <section className="border-t border-zinc-200 pt-4">
      <h3 className="mb-1 flex items-center gap-2 text-section text-brand-black">
        {Icon && <Icon aria-hidden className="size-[18px] text-zinc-500" />}
        {title}
        {count != null && <span className="rounded-full bg-zinc-100 px-2 text-meta font-medium text-zinc-700">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Meta({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta font-medium text-zinc-600">{label}</dt>
      <dd className="break-words text-brand-black">{children}</dd>
    </div>
  );
}

// Full record view used by the incoming, outgoing-history and supervisor screens.
export function HandoverDetail({ record, headerActions }) {
  const carried = record.tasks.filter((t) => t.carried_from_task_id).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-semibold tracking-wide text-zinc-600 uppercase">{record.department_name}</p>
          <h2 className="text-lg font-semibold text-brand-black">{shiftLabel(record)} · {fmt(record.shift_start)}</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={record.status} className="px-2.5 py-1" />
          {headerActions}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg bg-zinc-50 px-4 py-3 sm:grid-cols-4">
        <Meta label="Outgoing">{record.outgoing_name ?? '—'}</Meta>
        <Meta label="Incoming">{record.incoming_name ?? '—'}</Meta>
        <Meta label="Submitted">{fmt(record.submitted_at)}</Meta>
        {record.closed_at
          ? <Meta label="Closed">{fmt(record.closed_at)}</Meta>
          : <Meta label="Template">{record.template ? `v${record.template.version}` : '—'}</Meta>}
      </dl>

      <Section title="Summary" icon={FileText}>
        {record.summary_notes
          ? <p className="mt-1 whitespace-pre-wrap text-zinc-800">{record.summary_notes}</p>
          : <p className="mt-1 text-zinc-600">No summary.</p>}
      </Section>

      <Section title="Tasks" count={record.tasks.length} icon={ClipboardList}>
        {carried > 0 && <p className="text-meta text-zinc-600">{carried} carried forward from the previous shift</p>}
        <TaskTable tasks={record.tasks} />
      </Section>

      <Section title="Incidents" count={record.incidents.length} icon={AlertTriangle}>
        <IncidentTable incidents={record.incidents} />
      </Section>

      {record.thread?.length > 0 && (
        <Section title="History" icon={History}>
          <div className="mt-3"><Timeline items={record.thread} /></div>
        </Section>
      )}
    </div>
  );
}
