import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronRight, CircleCheckBig, HelpCircle, Hourglass, ShieldCheck,
} from 'lucide-react';
import api from '../api';
import { HandoverDetail, RecordTable } from '../components/Handover';
import {
  Button, Callout, Card, ConfirmDialog, Drawer, EmptyState, Modal, PageHeader, SkeletonCard, SkeletonTable, StatusBadge,
  Textarea,
} from '../components/ui';
import {
  cx, fmt, fmtRelative, shiftLabel,
} from '../lib/format';
import { toastError } from '../lib/toast';
import useAction from '../lib/useAction';

// Acknowledge (primary, confirmed) and Raise query (secondary) for a submitted record.
// `bare` drops the card chrome (for use inside a drawer footer).
function ResponseActions({ record, onDone, className, bare = false }) {
  const [dialog, setDialog] = useState(null); // 'ack' | 'query' | null
  const [comments, setComments] = useState('');
  const [run, busy] = useAction();

  const close = () => { if (!busy) { setDialog(null); setComments(''); } };
  const act = async (kind) => {
    const ok = await run(async () => {
      const path = kind === 'ack' ? 'acknowledgement' : 'query';
      await api.post(`/handovers/${record.record_id}/${path}`, { comments: comments.trim() || undefined });
    }, kind === 'ack' ? 'Handover acknowledged' : 'Query sent to the outgoing staff member');
    if (ok) {
      setDialog(null);
      setComments('');
      onDone(record.record_id);
    }
  };

  if (record.status === 'queried') {
    return (
      <Callout tone="warning" icon={Hourglass} title="Waiting for clarification" className={className}>
        {record.outgoing_name ?? 'The outgoing staff member'} has been asked to answer your query. You can acknowledge once it&apos;s resolved.
      </Callout>
    );
  }
  if (record.status !== 'submitted') return null;

  return (
    <div className={cx('flex flex-col gap-3 sm:flex-row sm:items-center', !bare && 'rounded-xl border border-zinc-200 bg-white p-4 shadow-pop', className)}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-brand-black">Your response is needed</p>
        <p className="hidden text-meta text-zinc-600 sm:block">Acknowledge once you have read and understood the full handover, or raise a query if anything is unclear.</p>
      </div>
      <div className="flex gap-2">
        <Button icon={HelpCircle} className="flex-1 max-sm:[&>svg]:hidden sm:flex-none" onClick={() => setDialog('query')}>Raise query</Button>
        <Button variant="primary" icon={CheckCircle2} className="flex-1 max-sm:[&>svg]:hidden sm:flex-none" onClick={() => setDialog('ack')}>Acknowledge</Button>
      </div>

      <ConfirmDialog
        open={dialog === 'ack'}
        onClose={close}
        onConfirm={() => act('ack')}
        loading={busy}
        icon={ShieldCheck}
        title="Acknowledge this handover?"
        confirmLabel="Yes, acknowledge"
        message={(
          <p>
            You confirm you have received and understood the {shiftLabel(record).toLowerCase()} handover from{' '}
            <strong className="text-brand-black">{record.outgoing_name}</strong>, including {record.tasks.length} task(s) and{' '}
            {record.incidents.length} incident(s). This is recorded against your name and can&apos;t be undone.
          </p>
        )}
      >
        <Textarea className="mt-4" label="Comments" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Optional note for the record" />
      </ConfirmDialog>

      <Modal
        open={dialog === 'query'}
        onClose={close}
        title="Raise a query"
        description={`${record.outgoing_name ?? 'The outgoing staff member'} will be notified and asked to clarify.`}
        footer={(
          <>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={HelpCircle} loading={busy} disabled={!comments.trim()} onClick={() => act('query')}>Send query</Button>
          </>
        )}
      >
        <Textarea label="What needs clarifying?" required rows={4} value={comments} onChange={(e) => setComments(e.target.value)} data-autofocus />
      </Modal>
    </div>
  );
}

function PendingItem({ record, selected, onSelect }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(record.record_id)}
        aria-current={selected || undefined}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-card transition-colors',
          selected ? 'border-zinc-400 shadow-[inset_3px_0_0_var(--color-brand-red)]' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-brand-black">{shiftLabel(record)}</span>
            <StatusBadge value={record.status} />
          </div>
          <p className="mt-0.5 text-meta text-zinc-600">{fmt(record.shift_start)}</p>
          <p className="mt-1 text-meta text-zinc-700">From {record.outgoing_name} · submitted {fmtRelative(record.submitted_at)}</p>
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-400" />
      </button>
    </li>
  );
}

function PendingView({ records, loading, reloadList }) {
  const pending = records.filter((r) => ['submitted', 'queried'].includes(r.status));
  const [selectedId, setSelectedId] = useState(null);
  const [record, setRecord] = useState(null);

  const open = useCallback(async (id) => {
    setSelectedId(id);
    try {
      setRecord((await api.get(`/handovers/${id}`)).data);
    } catch (err) {
      toastError(err);
    }
  }, []);

  // Open the oldest pending handover automatically.
  useEffect(() => {
    if (!selectedId && pending.length) open(pending[0].record_id);
  }, [pending, selectedId, open]);

  if (loading) return <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]"><SkeletonCard lines={2} /><SkeletonCard lines={8} /></div>;
  if (!pending.length) {
    return (
      <Card>
        <EmptyState icon={CircleCheckBig} title="You're all caught up" message="There are no handovers waiting for your acknowledgement. New ones will appear here and in your notifications." />
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <section aria-label="Pending handovers" className="lg:sticky lg:top-20">
        <h2 className="mb-2 text-meta font-semibold tracking-wide text-zinc-600 uppercase">{pending.length} pending</h2>
        <ul className="space-y-2">
          {pending.map((r) => <PendingItem key={r.record_id} record={r} selected={r.record_id === selectedId} onSelect={open} />)}
        </ul>
      </section>

      <div className="min-w-0 space-y-4">
        {record && record.record_id === selectedId ? (
          <>
            <Card><HandoverDetail record={record} /></Card>
            <ResponseActions
              record={record}
              className="sticky bottom-4 z-20"
              onDone={async (id) => { await reloadList(); open(id); }}
            />
          </>
        ) : <SkeletonCard lines={8} />}
      </div>
    </div>
  );
}

function AllView({ records, loading, reloadList }) {
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
        {loading
          ? <SkeletonTable />
          : <RecordTable records={records} onSelect={open} selectedId={selected?.record_id} empty="No handovers have been assigned to you yet." />}
      </Card>
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Handover record"
        footer={selected && ['submitted', 'queried'].includes(selected.status)
          ? <ResponseActions record={selected} bare onDone={async (id) => { await reloadList(); open(id); }} />
          : null}
      >
        {selected && <HandoverDetail record={selected} />}
      </Drawer>
    </>
  );
}

export default function IncomingPage({ view }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    try {
      setRecords((await api.get('/handovers')).data);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  return (
    <>
      <PageHeader
        title={view === 'pending' ? 'Awaiting action' : 'All handovers'}
        subtitle={view === 'pending' ? 'Handovers assigned to you that still need your acknowledgement.' : 'Every handover that has been assigned to you.'}
      />
      {view === 'pending'
        ? <PendingView records={records} loading={loading} reloadList={loadList} />
        : <AllView records={records} loading={loading} reloadList={loadList} />}
    </>
  );
}
