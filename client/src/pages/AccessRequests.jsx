import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Check, CheckCircle2, Copy, Inbox, KeyRound, UserCheck, UserX, XCircle,
} from 'lucide-react';
import api from '../api';
import {
  Badge, Button, Callout, Card, ConfirmDialog, EmptyState, Input, Modal, Select, SkeletonTable, Table, Textarea,
} from '../components/ui';
import { ROLE_LABEL, cx, fmt, fmtRelative } from '../lib/format';
import { toast } from '../lib/toast';
import useAction from '../lib/useAction';

const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));

function ApproveDialog({ request, departments, onClose, onApproved }) {
  const requestedDept = departments.find((d) => d.code === request.requested_department_code);
  const [form, setForm] = useState({ role: '', department_id: requestedDept?.department_id ?? '', staff_number: request.staff_number ?? '' });
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [run, busy] = useAction();

  const approve = async () => {
    await run(async () => {
      const { data } = await api.post(`/admin/access-requests/${request.request_id}/approve`, {
        role: form.role,
        department_id: form.department_id || null,
        staff_number: form.staff_number || undefined,
      });
      setResult(data);
      onApproved();
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
      toast.success('Temporary password copied');
    } catch {
      toast.error('Copy failed — select the password and copy it manually.');
    }
  };

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Account created"
        description={`${result.user.full_name} · ${ROLE_LABEL[result.user.role]}`}
        footer={<Button variant="primary" onClick={onClose} data-autofocus>Done</Button>}
      >
        <div className="space-y-4">
          <Callout tone="success" title="Access request approved">
            Sign-in: <strong>{result.user.staff_number}</strong> or <strong>{result.user.email}</strong>
          </Callout>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-800"><KeyRound aria-hidden className="size-4" />Temporary password</p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 rounded-lg bg-brand-black px-3 py-2 font-mono text-base tracking-wider text-white select-all">{result.temporary_password}</code>
              <Button icon={copied ? Check : Copy} onClick={copy} aria-label="Copy temporary password">{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="mt-2 text-meta text-ink-600">
              This is shown only once. Pass it to {result.user.full_name.split(' ')[0]} through a secure channel.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  const needsDept = form.role && form.role !== 'admin';
  const ready = form.role && (!needsDept || form.department_id) && form.staff_number.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${request.full_name}?`}
      description="Choose the access this person gets. Their request does not set it."
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={UserCheck} loading={busy} disabled={!ready} onClick={approve}>Create account</Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <Select label="Role" required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Select a role…" options={ROLE_OPTIONS} data-autofocus />
        <Select
          label="Department"
          required={needsDept}
          value={form.department_id}
          onChange={(e) => setForm({ ...form, department_id: e.target.value })}
          placeholder="— None —"
          options={departments.map((d) => ({ value: d.department_id, label: d.name }))}
          hint={requestedDept ? `Requested: ${requestedDept.name}` : undefined}
        />
        <Input
          label="Staff number"
          required
          value={form.staff_number}
          onChange={(e) => setForm({ ...form, staff_number: e.target.value })}
          hint={request.staff_number ? 'As provided in the request.' : 'Not provided in the request — enter it to create the account.'}
        />
      </div>
    </Modal>
  );
}

function RejectDialog({ request, onClose, onRejected }) {
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const reject = async () => {
    const ok = await run(() => api.post(`/admin/access-requests/${request.request_id}/reject`, { reason: reason.trim() || undefined }), `Request from ${request.full_name} rejected`);
    if (ok) { onRejected(); onClose(); }
  };
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={reject}
      loading={busy}
      tone="danger"
      icon={UserX}
      title={`Reject ${request.full_name}'s request?`}
      confirmLabel="Reject request"
      message={<p>No account will be created. They can submit a new request later.</p>}
    >
      <Textarea className="mt-4" label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional, kept with the request" />
    </ConfirmDialog>
  );
}

const STATUS_BADGE = {
  pending: <Badge tone="amber">Pending</Badge>,
  approved: <Badge tone="green" icon={CheckCircle2}>Approved</Badge>,
  rejected: <Badge tone="gray" icon={XCircle}>Rejected</Badge>,
};

export default function AccessRequests({ departments }) {
  const [view, setView] = useState('pending');
  const [rows, setRows] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows((await api.get('/admin/access-requests', { params: { status: view === 'pending' ? 'pending' : 'all' } })).data
        .filter((r) => view === 'pending' || r.status !== 'pending'));
    } catch {
      setRows([]);
      toast.error('Access requests could not be loaded');
    }
  }, [view]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const requester = {
    key: 'requester',
    header: 'Requester',
    render: (r) => (
      <div className="min-w-[12rem]">
        <p className="font-medium text-fg">{r.full_name}</p>
        <p className="text-meta text-ink-600">{r.email}{r.staff_number && <> · <span className="font-mono">{r.staff_number}</span></>}</p>
      </div>
    ),
  };
  const dept = { key: 'dept', header: 'Department', hideBelow: 'md', render: (r) => <Badge tone="gray" icon={Building2} className="bg-surface">{r.requested_department_name}</Badge> };

  const pendingColumns = [
    requester,
    dept,
    { key: 'note', header: 'Note', hideBelow: 'lg', render: (r) => (r.note ? <p className="max-w-xs text-ink-700 line-clamp-2" title={r.note}>{r.note}</p> : <span className="text-ink-500">—</span>) },
    { key: 'created', header: 'Received', hideBelow: 'sm', render: (r) => <span className="whitespace-nowrap text-ink-700" title={fmt(r.created_at)}>{fmtRelative(r.created_at)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="danger" icon={UserX} onClick={() => setRejecting(r)} aria-label={`Reject ${r.full_name}`}>
            <span className="hidden xl:inline">Reject</span>
          </Button>
          <Button size="sm" variant="primary" icon={UserCheck} onClick={() => setApproving(r)} aria-label={`Approve ${r.full_name}`}>
            <span className="hidden sm:inline">Approve</span>
          </Button>
        </div>
      ),
    },
  ];

  const reviewedColumns = [
    requester,
    dept,
    { key: 'status', header: 'Decision', render: (r) => STATUS_BADGE[r.status] },
    {
      key: 'reviewed',
      header: 'Reviewed',
      hideBelow: 'sm',
      render: (r) => (
        <div className="text-meta">
          <p className="text-ink-800">{r.reviewed_by_name}</p>
          <p className="text-ink-600">{fmt(r.reviewed_at)}</p>
        </div>
      ),
    },
    { key: 'reason', header: 'Reason', hideBelow: 'lg', render: (r) => r.review_reason ?? <span className="text-ink-500">—</span> },
  ];

  return (
    <>
      <Card flush>
        <div role="group" aria-label="Request status" className="flex gap-1 border-b border-ink-200 px-3 pt-3">
          {[['pending', 'Pending'], ['reviewed', 'Reviewed']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cx(
                '-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                view === value ? 'border-brand-red text-fg' : 'border-transparent text-ink-600 hover:text-fg',
              )}
            >
              {label}
              {value === 'pending' && view === 'pending' && rows && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-meta text-ink-700">{rows.length}</span>}
            </button>
          ))}
        </div>
        {rows === null ? <SkeletonTable rows={3} /> : (
          <Table
            columns={view === 'pending' ? pendingColumns : reviewedColumns}
            rows={rows}
            rowKey={(r) => r.request_id}
            caption={view === 'pending' ? 'Pending access requests' : 'Reviewed access requests'}
            empty={view === 'pending'
              ? <EmptyState icon={Inbox} title="No pending requests" message="New requests from the public Request access form appear here." />
              : <EmptyState icon={Inbox} title="No reviewed requests yet" />}
          />
        )}
      </Card>

      {approving && <ApproveDialog request={approving} departments={departments} onClose={() => setApproving(null)} onApproved={load} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onRejected={load} />}
    </>
  );
}
