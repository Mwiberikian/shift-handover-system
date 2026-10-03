import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleCheckBig, Eye, FileSearch, HelpCircle, Inbox, Layers, RefreshCw, Search as SearchIcon,
  Send, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import api from '../api';
import { HandoverDetail, RECORD_COLUMNS, RecordTable } from '../components/Handover';
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, Input, PageHeader, Select, SkeletonStats, SkeletonTable, StatusBadge,
  Table, Textarea, optionsFor,
} from '../components/ui';
import { cx, fmt, fmtRelative, shiftLabel } from '../lib/format';
import { toastError } from '../lib/toast';
import useAction from '../lib/useAction';

const TITLES = {
  overview: ['Overview', 'Handover status across your departments.'],
  queue: ['Review queue', 'Acknowledged handovers awaiting supervisor review.'],
  escalated: ['Escalated', 'Handovers escalated for resolution.'],
  search: ['Search', 'Find handover records by keyword, status or date.'],
};

const STAT_TONE = {
  gray: 'bg-status-gray-soft text-status-gray',
  blue: 'bg-status-blue-soft text-status-blue',
  amber: 'bg-status-amber-soft text-status-amber',
  green: 'bg-status-green-soft text-status-green',
  red: 'bg-status-red-soft text-status-red',
};

function StatCard({ label, value, icon: Icon, tone = 'gray', alert = false, hint }) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-xl border bg-white p-4 shadow-card transition-shadow',
        alert ? 'border-status-red-line' : 'border-zinc-200',
      )}
    >
      {alert && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand-red" />}
      <div className="flex items-start justify-between gap-2">
        <p className={cx('text-meta font-medium', alert ? 'text-status-red' : 'text-zinc-600')}>{label}</p>
        <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', STAT_TONE[alert ? 'red' : tone])}>
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <p className={cx('mt-1 text-3xl font-semibold tracking-tight tabular-nums', alert ? 'text-status-red' : 'text-brand-black')}>{value}</p>
      {hint && <p className="mt-0.5 text-meta text-zinc-600">{hint}</p>}
    </div>
  );
}

const sum = (rows, key) => rows.reduce((n, d) => n + (d[key] || 0), 0);

const DEPT_COLUMNS = [
  ['open', 'Open'], ['submitted', 'Submitted'], ['queried', 'Queried'], ['acknowledged', 'Ackd'],
  ['under_review', 'In review'], ['escalated', 'Escalated'], ['closed', 'Closed'],
];

function Overview({ data, onOpen }) {
  const d = data.departments;
  const overdue = sum(d, 'unacknowledged_overdue');
  const deptColumns = [
    { key: 'name', header: 'Department', render: (r) => <span className="font-medium text-brand-black">{r.name}</span> },
    ...DEPT_COLUMNS.map(([key, header]) => ({
      key,
      header,
      className: 'text-right tabular-nums',
      hideBelow: ['open', 'closed', 'under_review'].includes(key) ? 'lg' : 'sm',
      render: (r) => <span className={r[key] ? 'text-brand-black' : 'text-zinc-400'}>{r[key]}</span>,
    })),
    {
      key: 'overdue',
      header: 'Overdue',
      className: 'text-right',
      render: (r) => (r.unacknowledged_overdue
        ? <span className="inline-flex items-center gap-1 font-semibold text-status-red"><AlertTriangle aria-hidden className="size-3.5" />{r.unacknowledged_overdue}</span>
        : <span className="text-zinc-400">0</span>),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={`Unacknowledged > ${data.threshold_hours}h`}
          value={overdue}
          icon={AlertTriangle}
          alert={overdue > 0}
          tone="gray"
          hint={overdue ? 'Needs attention' : 'None overdue'}
        />
        <StatCard label="Awaiting acknowledgement" value={sum(d, 'submitted')} icon={Send} tone="blue" />
        <StatCard label="Queried" value={sum(d, 'queried')} icon={HelpCircle} tone="amber" />
        <StatCard label="Awaiting review" value={sum(d, 'acknowledged')} icon={Eye} tone="green" />
        <StatCard label="Escalated" value={sum(d, 'escalated')} icon={ShieldAlert} tone={sum(d, 'escalated') ? 'red' : 'gray'} />
        <StatCard label="Closed" value={sum(d, 'closed')} icon={CheckCircle2} tone="gray" />
      </div>

      {data.unacknowledged_alerts.length > 0 && (
        <Card flush className="overflow-hidden border-status-red-line">
          <div className="flex items-start gap-3 border-b border-status-red-line bg-status-red-soft px-4 py-3 sm:px-5">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-status-red" />
            <div>
              <h2 className="text-section text-status-red">
                {data.unacknowledged_alerts.length} handover{data.unacknowledged_alerts.length === 1 ? '' : 's'} not acknowledged within {data.threshold_hours} hours
              </h2>
              <p className="text-meta text-zinc-700">Counted from shift start. Follow up with the incoming staff member.</p>
            </div>
          </div>
          <ul className="divide-y divide-zinc-100">
            {data.unacknowledged_alerts.map((a) => (
              <li key={a.record_id}>
                <button
                  type="button"
                  onClick={() => onOpen(a.record_id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-zinc-50 sm:px-5"
                >
                  <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <span className="block font-medium text-brand-black">{shiftLabel(a)} · {fmt(a.shift_start)}</span>
                    <span className="block text-meta text-zinc-600">{a.outgoing_name} → {a.incoming_name ?? 'unassigned'}</span>
                  </span>
                  <StatusBadge value={a.status} />
                  <span className="text-meta font-semibold whitespace-nowrap text-status-red tabular-nums">{a.hours_since_shift_start} h since start</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="By department" subtitle={`Updated ${fmtRelative(data.generated_at)}`} icon={Layers} flush>
        <Table columns={deptColumns} rows={d} rowKey={(r) => r.department_id} caption="Handover counts by department" />
      </Card>
    </div>
  );
}

function ReviewActions({ record, onDone }) {
  const [comments, setComments] = useState('');
  const [confirmEscalate, setConfirmEscalate] = useState(false);
  const [run, busy] = useAction();
  const [pending, setPending] = useState(null);

  const act = async (path, body, success) => {
    setPending(path + (body.decision ?? ''));
    const ok = await run(() => api.post(`/handovers/${record.record_id}/${path}`, { ...body, comments: comments || undefined }), success);
    setPending(null);
    setConfirmEscalate(false);
    if (ok) {
      setComments('');
      onDone(record.record_id);
    }
  };

  if (!['acknowledged', 'escalated'].includes(record.status)) return null;
  const isReview = record.status === 'acknowledged';
  return (
    <div className="space-y-3">
      <Textarea label={isReview ? 'Review comments' : 'Resolution notes'} rows={2} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional" />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {isReview ? (
          <>
            <Button variant="danger" icon={ShieldAlert} onClick={() => setConfirmEscalate(true)} disabled={busy}>Escalate</Button>
            <Button variant="primary" icon={ShieldCheck} loading={pending === 'reviewapproved'} disabled={busy} onClick={() => act('review', { decision: 'approved' }, 'Handover approved and closed')}>
              Approve &amp; close
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={() => act('resolve', {}, 'Escalation resolved and record closed')}>
            Mark resolved &amp; close
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmEscalate}
        onClose={() => setConfirmEscalate(false)}
        onConfirm={() => act('review', { decision: 'escalated' }, 'Handover escalated')}
        loading={pending === 'reviewescalated'}
        tone="danger"
        title="Escalate this handover?"
        confirmLabel="Escalate"
        message={<p>The record moves to the escalated list and stays open until someone marks it resolved.{comments ? '' : ' Consider adding a comment explaining why.'}</p>}
      />
    </div>
  );
}

function Search({ onOpen, selectedId, columns, rowClassName }) {
  const [q, setQ] = useState({ q: '', status: '', from: '', to: '' });
  const [results, setResults] = useState(null);
  const [run, busy] = useAction();

  const submit = (e) => {
    e.preventDefault();
    const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
    if (params.to) params.to = `${params.to}T23:59:59`;
    run(async () => setResults((await api.get('/handovers/search', { params })).data));
  };

  return (
    <div className="space-y-6">
      <Card>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_10rem_10rem_auto] lg:items-end">
          <Input label="Keyword" placeholder="Summary or task text" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} className="sm:col-span-2 lg:col-span-1" />
          <Select label="Status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })} placeholder="Any status" options={optionsFor('record')} className="sm:col-span-2 lg:col-span-1" />
          <Input label="From" type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />
          <Input label="To" type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />
          <Button type="submit" variant="primary" icon={SearchIcon} loading={busy} className="sm:col-span-2 lg:col-span-1">Search</Button>
        </form>
      </Card>
      <Card flush title={results ? `${results.length} result${results.length === 1 ? '' : 's'}` : undefined}>
        {busy && !results ? <SkeletonTable /> : results
          ? <RecordTable records={results} onSelect={onOpen} selectedId={selectedId} columns={columns} rowClassName={rowClassName} empty="No records match these filters." />
          : <EmptyState icon={FileSearch} title="Search handover records" message="Filter by keyword, status or shift date. Leave fields blank to match everything." />}
      </Card>
    </div>
  );
}

export default function SupervisorPage({ view }) {
  const [dash, setDash] = useState(null);
  const [queue, setQueue] = useState(null);
  const [escalated, setEscalated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, q, e] = await Promise.all([
        api.get('/dashboard/supervisor'),
        api.get('/handovers', { params: { status: 'acknowledged' } }),
        api.get('/handovers', { params: { status: 'escalated' } }),
      ]);
      setDash(d.data);
      setQueue(q.data);
      setEscalated(e.data);
    } catch (err) {
      toastError(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const open = async (id) => {
    try {
      setSelected((await api.get(`/handovers/${id}`)).data);
    } catch (err) {
      toastError(err);
    }
  };

  useEffect(() => { load(); }, [load]);

  // Records flagged by the dashboard as unacknowledged past the threshold get
  // a red accent and alert icon wherever they appear in a table.
  const overdueIds = useMemo(() => new Set(dash?.unacknowledged_alerts.map((a) => a.record_id) ?? []), [dash]);
  const columns = useMemo(() => RECORD_COLUMNS.map((c) => (c.key !== 'status' ? c : {
    ...c,
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge value={r.status} />
        {overdueIds.has(r.record_id) && (
          <span title={`Unacknowledged more than ${dash.threshold_hours} h after shift start`} className="inline-flex items-center gap-0.5 text-meta font-semibold text-status-red">
            <AlertTriangle aria-hidden className="size-3.5" />Overdue
          </span>
        )}
      </span>
    ),
  })), [overdueIds, dash]);
  const rowClassName = (r) => overdueIds.has(r.record_id) && 'shadow-[inset_3px_0_0_var(--color-brand-red)]';

  const [title, subtitle] = TITLES[view];
  const tableFor = (rows, emptyIcon, empty) => (
    <Card flush>
      {rows === null ? <SkeletonTable /> : rows.length === 0
        ? <EmptyState icon={emptyIcon} title={empty[0]} message={empty[1]} />
        : <RecordTable records={rows} onSelect={open} selectedId={selected?.record_id} columns={columns} rowClassName={rowClassName} />}
    </Card>
  );

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={view !== 'search' && (
          <Button icon={RefreshCw} onClick={load} loading={refreshing}>Refresh</Button>
        )}
      />

      {view === 'overview' && (dash ? <Overview data={dash} onOpen={open} /> : <div className="space-y-6"><SkeletonStats count={6} /><Card flush><SkeletonTable rows={3} /></Card></div>)}
      {view === 'queue' && tableFor(queue, Inbox, ['Review queue is clear', 'Acknowledged handovers will appear here for your review.'])}
      {view === 'escalated' && tableFor(escalated, CircleCheckBig, ['No escalations', 'Nothing is currently escalated.'])}
      {view === 'search' && <Search onOpen={open} selectedId={selected?.record_id} columns={columns} rowClassName={rowClassName} />}

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Handover record"
        footer={selected && ['acknowledged', 'escalated'].includes(selected.status)
          ? <ReviewActions record={selected} onDone={(id) => { load(); open(id); }} />
          : null}
      >
        {selected && (
          <div className="space-y-5">
            {overdueIds.has(selected.record_id) && (
              <div className="flex items-center gap-2 rounded-lg border border-status-red-line bg-status-red-soft px-3 py-2 text-meta font-medium text-status-red">
                <AlertTriangle aria-hidden className="size-4" /> Not acknowledged within {dash.threshold_hours} hours of shift start
              </div>
            )}
            <HandoverDetail record={selected} />
            {selected.reviews?.length > 0 && (
              <section className="border-t border-zinc-200 pt-4">
                <h3 className="mb-2 flex items-center gap-2 text-section text-brand-black"><ShieldCheck aria-hidden className="size-[18px] text-zinc-500" />Reviews</h3>
                <ul className="space-y-2">
                  {selected.reviews.map((r) => (
                    <li key={r.review_id} className="rounded-lg bg-zinc-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.decision === 'approved'
                          ? <Badge tone="green" icon={ShieldCheck}>Approved</Badge>
                          : <Badge tone="red" icon={ShieldAlert}>Escalated</Badge>}
                        <span className="text-zinc-700">by {r.supervisor_name} · {fmt(r.reviewed_at)}</span>
                      </div>
                      {r.comments && <p className="mt-1 text-zinc-800">{r.comments}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
