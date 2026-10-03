import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, Braces, Building2, FileCog, History, ListChecks, Pencil, RotateCcw, Save, Search,
  Shield, UserCheck, UserCog, UserPlus, UserX, Users as UsersIcon,
} from 'lucide-react';
import api from '../api';
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, JsonView, Modal, PageHeader, Select, SkeletonCard,
  SkeletonTable, Table,
} from '../components/ui';
import { ROLE_LABEL, cx, initials } from '../lib/format';
import { toast, toastError } from '../lib/toast';
import useAction from '../lib/useAction';

const ROLES = ['outgoing_staff', 'incoming_staff', 'supervisor', 'admin'];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const ROLE_BADGE = {
  admin: ['dark', Shield],
  supervisor: ['blue', UserCog],
  outgoing_staff: ['gray', ArrowUpFromLine],
  incoming_staff: ['gray', ArrowDownToLine],
};
const EMPTY_USER = { staff_number: '', full_name: '', email: '', password: '', role: 'outgoing_staff', department_id: '' };

function RoleBadge({ role }) {
  const [tone, icon] = ROLE_BADGE[role] ?? ['gray', null];
  return <Badge tone={tone} icon={icon}>{ROLE_LABEL[role] ?? role}</Badge>;
}

function UserForm({ open, onClose, departments, onCreated }) {
  const [form, setForm] = useState(EMPTY_USER);
  const [run, busy] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post('/admin/users', { ...form, department_id: form.department_id || null }), `Account created for ${form.full_name}`);
    if (ok) {
      setForm(EMPTY_USER);
      onCreated();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New user account"
      description="The user signs in with their staff number or email and this password."
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-user" icon={UserPlus} loading={busy}>Create account</Button>
        </>
      )}
    >
      <form id="new-user" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Staff number" required value={form.staff_number} onChange={set('staff_number')} placeholder="KQ1234" data-autofocus />
        <Input label="Full name" required value={form.full_name} onChange={set('full_name')} />
        <Input label="Email" type="email" required value={form.email} onChange={set('email')} />
        <Input label="Initial password" type="password" required minLength={8} value={form.password} onChange={set('password')} hint="At least 8 characters." autoComplete="new-password" />
        <Select label="Role" required value={form.role} onChange={set('role')} options={ROLE_OPTIONS} />
        <Select
          label="Department"
          value={form.department_id}
          onChange={set('department_id')}
          placeholder="— None —"
          options={departments.map((d) => ({ value: d.department_id, label: d.name }))}
          hint={form.role === 'admin' ? 'Administrators usually have no department.' : undefined}
        />
      </form>
    </Modal>
  );
}

function EditUser({ user, onClose, departments, onSaved }) {
  const [edit, setEdit] = useState({ role: user.role, department_id: user.department_id || '' });
  const [run, busy] = useAction();
  const save = async () => {
    const ok = await run(() => api.patch(`/admin/users/${user.user_id}`, { role: edit.role, department_id: edit.department_id || null }), 'User updated');
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.full_name}`}
      description={`${user.staff_number} · ${user.email}`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>Save changes</Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <Select label="Role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={ROLE_OPTIONS} data-autofocus />
        <Select
          label="Department"
          value={edit.department_id}
          onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}
          placeholder="— None —"
          options={departments.map((d) => ({ value: d.department_id, label: d.name }))}
        />
      </div>
    </Modal>
  );
}

function Users({ departments, newOpen, setNewOpen }) {
  const [users, setUsers] = useState(null);
  const [filter, setFilter] = useState({ q: '', role: '' });
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [run, busy] = useAction();

  const load = useCallback(() => api.get('/admin/users').then((r) => setUsers(r.data)).catch(toastError), []);
  useEffect(() => { load(); }, [load]);

  const setActive = async (user, isActive) => {
    const ok = await run(
      () => api.patch(`/admin/users/${user.user_id}`, { is_active: isActive }),
      isActive ? `${user.full_name} reactivated` : `${user.full_name} deactivated`,
    );
    if (ok) { setDeactivating(null); load(); }
  };

  const shown = useMemo(() => {
    if (!users) return null;
    const q = filter.q.trim().toLowerCase();
    return users.filter((u) => (!filter.role || u.role === filter.role)
      && (!q || [u.full_name, u.staff_number, u.email].some((v) => v?.toLowerCase().includes(q))));
  }, [users, filter]);

  const columns = [
    {
      key: 'user',
      header: 'User',
      render: (u) => (
        <div className="flex min-w-[12rem] items-center gap-3">
          <span aria-hidden className={cx('grid size-8 shrink-0 place-items-center rounded-full text-meta font-semibold', u.is_active ? 'bg-zinc-100 text-zinc-700' : 'bg-zinc-50 text-zinc-400')}>
            {initials(u.full_name)}
          </span>
          <div className="min-w-0">
            <p className={cx('font-medium', u.is_active ? 'text-brand-black' : 'text-zinc-500')}>{u.full_name}</p>
            <p className="truncate text-meta text-zinc-600">{u.email}</p>
            <div className="mt-1 sm:hidden"><RoleBadge role={u.role} /></div>
          </div>
        </div>
      ),
    },
    { key: 'staff_number', header: 'Staff #', hideBelow: 'md', render: (u) => <span className="font-mono text-meta text-zinc-700">{u.staff_number}</span> },
    { key: 'role', header: 'Role', hideBelow: 'sm', render: (u) => <RoleBadge role={u.role} /> },
    {
      key: 'department',
      header: 'Department',
      hideBelow: 'lg',
      render: (u) => (u.department_name
        ? <Badge tone="gray" icon={Building2} className="bg-white">{u.department_name}</Badge>
        : <span className="text-zinc-500">—</span>),
    },
    {
      key: 'status',
      header: 'Status',
      hideBelow: 'sm',
      render: (u) => (u.is_active
        ? <span className="inline-flex items-center gap-1.5 text-status-green"><span aria-hidden className="size-1.5 rounded-full bg-status-green" />Active</span>
        : <span className="inline-flex items-center gap-1.5 text-zinc-600"><span aria-hidden className="size-1.5 rounded-full bg-zinc-400" />Inactive</span>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u)} aria-label={`Edit ${u.full_name}`}>
            <span className="hidden xl:inline">Edit</span>
          </Button>
          {u.is_active
            ? <Button size="sm" variant="danger" icon={UserX} onClick={() => setDeactivating(u)} aria-label={`Deactivate ${u.full_name}`}><span className="hidden xl:inline">Deactivate</span></Button>
            : <Button size="sm" icon={UserCheck} onClick={() => setActive(u, true)} disabled={busy} aria-label={`Reactivate ${u.full_name}`}><span className="hidden xl:inline">Reactivate</span></Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card flush>
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-end">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-zinc-500" />
            <Input label="Search users" hideLabel placeholder="Search by name, staff number or email" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} inputClassName="pl-9" />
          </div>
          <Select label="Filter by role" hideLabel value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })} placeholder="All roles" options={ROLE_OPTIONS} className="sm:w-48" />
        </div>
        {shown === null ? <SkeletonTable rows={6} /> : (
          <Table
            columns={columns}
            rows={shown}
            rowKey={(u) => u.user_id}
            caption="User accounts"
            rowClassName={(u) => !u.is_active && 'bg-zinc-50/70'}
            empty={<EmptyState compact icon={UsersIcon} title="No users match" message="Try a different search or role filter." />}
          />
        )}
        {shown && <p className="border-t border-zinc-200 px-4 py-2.5 text-meta text-zinc-600">{shown.length} of {users.length} accounts</p>}
      </Card>

      <UserForm open={newOpen} onClose={() => setNewOpen(false)} departments={departments} onCreated={load} />
      {editing && <EditUser user={editing} departments={departments} onClose={() => setEditing(null)} onSaved={load} />}
      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={() => setActive(deactivating, false)}
        loading={busy}
        tone="danger"
        icon={UserX}
        title={`Deactivate ${deactivating?.full_name ?? ''}?`}
        confirmLabel="Deactivate account"
        message={<p>They will no longer be able to sign in or be assigned handovers. Their past records are kept, and you can reactivate the account later.</p>}
      />
    </>
  );
}

// Structured editor: one card per template key (summary_notes, tasks, incidents).
const KEY_INFO = {
  summary_notes: { type: 'text', minKey: 'minLength', minLabel: 'Minimum characters', blurb: 'Free-text summary written by the outgoing staff member.' },
  tasks: { type: 'list', minKey: 'minItems', minLabel: 'Minimum items', blurb: 'Outstanding tasks handed to the next shift.' },
  incidents: { type: 'list', minKey: 'minItems', minLabel: 'Minimum items', blurb: 'Incidents that occurred during the shift.' },
};

function toRows(def) {
  return Object.keys(KEY_INFO).map((key) => {
    const f = def.fields.find((x) => x.key === key);
    return { key, enabled: !!f, label: f?.label ?? '', required: !!f?.required, min: f?.[KEY_INFO[key].minKey] ?? '' };
  });
}

function fromRows(rows) {
  return {
    fields: rows.filter((r) => r.enabled).map((r) => {
      const info = KEY_INFO[r.key];
      const f = { key: r.key, label: r.label, type: info.type, required: r.required };
      if (r.min !== '' && r.min !== null) f[info.minKey] = Number(r.min);
      return f;
    }),
  };
}

function FieldEditor({ row, onChange }) {
  const info = KEY_INFO[row.key];
  return (
    <li className={cx('rounded-xl border p-4 transition-colors', row.enabled ? 'border-zinc-200 bg-white' : 'border-dashed border-zinc-300 bg-zinc-50/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-meta text-zinc-800">{row.key}</code>
            <Badge tone="gray">{info.type === 'text' ? 'Text' : 'List'}</Badge>
            {row.enabled && row.required && <Badge tone="dark">Mandatory</Badge>}
          </div>
          <p className="mt-1 text-meta text-zinc-600">{info.blurb}</p>
        </div>
        <Checkbox label="Include in template" checked={row.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
      </div>
      {row.enabled && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-end">
          <Input label="Label shown to staff" required value={row.label} onChange={(e) => onChange({ label: e.target.value })} />
          <Input label={info.minLabel} type="number" min="0" value={row.min} onChange={(e) => onChange({ min: e.target.value })} placeholder="None" />
          <Checkbox
            className="sm:col-span-2"
            label="Mandatory"
            description="The handover cannot be submitted until this field meets its minimum."
            checked={row.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
        </div>
      )}
    </li>
  );
}

function Templates({ departments }) {
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [viewVersion, setViewVersion] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [run, saving] = useAction();

  const load = useCallback(async (c) => {
    try {
      const { data: d } = await api.get(`/admin/templates/${c}`);
      setData(d);
      setRows(toRows(d.template.field_definition));
      setViewVersion(d.current_version);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => {
    if (!code && departments.length) setCode(departments[0].code);
  }, [departments, code]);
  useEffect(() => { if (code) { setData(null); load(code); } }, [code, load]);

  const update = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const draft = fromRows(rows);
  const dirty = data && JSON.stringify(rows) !== JSON.stringify(toRows(data.template.field_definition));

  const save = () => run(async () => {
    const { data: res } = await api.put(`/admin/templates/${code}`, { field_definition: draft });
    if (res.changed) toast.success(`Saved as version ${res.template.version}`, { description: 'Previous versions are kept for existing records.' });
    else toast.info('No changes — version unchanged.');
    await load(code);
  });

  const shown = data?.versions.find((v) => v.version === viewVersion);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Select
            label="Department"
            className="sm:w-80"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            options={departments.map((d) => ({ value: d.code, label: `${d.name} (${d.code})` }))}
          />
          {data && (
            <p className="flex items-center gap-2 text-zinc-600 sm:pb-2">
              Current version <Badge tone="green">v{data.current_version}</Badge>
              <span className="text-meta">· {data.versions.length} version{data.versions.length === 1 ? '' : 's'} total</span>
            </p>
          )}
        </div>
      </Card>

      {!data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"><SkeletonCard lines={8} /><SkeletonCard lines={4} /></div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card
            title="Checklist fields"
            subtitle="What outgoing staff must complete before submitting."
            icon={ListChecks}
            actions={(
              <Button size="sm" variant="ghost" icon={Braces} onClick={() => setShowJson((s) => !s)} aria-pressed={showJson}>
                {showJson ? 'Hide JSON' : 'Show JSON'}
              </Button>
            )}
          >
            <ul className="space-y-3">
              {rows.map((r, i) => <FieldEditor key={r.key} row={r} onChange={(patch) => update(i, patch)} />)}
            </ul>
            {showJson && (
              <div className="mt-5">
                <p className="mb-2 text-meta font-medium text-zinc-600">field_definition that will be saved</p>
                <JsonView value={draft} label="Draft field definition JSON" />
              </div>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
              {dirty && <span className="text-meta font-medium text-status-amber sm:mr-auto">Unsaved changes</span>}
              <Button icon={RotateCcw} disabled={!dirty || saving} onClick={() => setRows(toRows(data.template.field_definition))}>Discard</Button>
              <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>Save as v{data.current_version + 1}</Button>
            </div>
          </Card>

          <Card title="Version history" icon={History} className="lg:sticky lg:top-20" bodyClassName="space-y-4">
            <ol className="space-y-1" aria-label="Template versions">
              {data.versions.slice().sort((a, b) => b.version - a.version).map((v) => (
                <li key={v.template_id}>
                  <button
                    type="button"
                    onClick={() => setViewVersion(v.version)}
                    aria-pressed={viewVersion === v.version}
                    className={cx(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                      viewVersion === v.version ? 'bg-zinc-100 font-medium text-brand-black' : 'text-zinc-700 hover:bg-zinc-50',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <FileCog aria-hidden className="size-4 text-zinc-500" />
                      Version {v.version}
                    </span>
                    {v.version === data.current_version && <Badge tone="green">Current</Badge>}
                  </button>
                </li>
              ))}
            </ol>
            {shown && (
              <div className="space-y-2">
                <JsonView value={shown.field_definition} label={`Version ${shown.version} field definition`} className="max-h-80 text-[12px]" />
                {shown.version !== data.current_version && (
                  <Button size="sm" icon={RotateCcw} className="w-full" onClick={() => { setRows(toRows(shown.field_definition)); toast.info(`Loaded v${shown.version} into the editor`, { description: 'Save to publish it as a new version.' }); }}>
                    Load v{shown.version} into editor
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function AdminPage({ view }) {
  const [departments, setDepartments] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  useEffect(() => { api.get('/admin/departments').then((r) => setDepartments(r.data)).catch(toastError); }, []);

  return view === 'users' ? (
    <>
      <PageHeader
        title="Users"
        subtitle="Create accounts, change roles and departments, and deactivate access."
        actions={<Button variant="primary" icon={UserPlus} onClick={() => setNewOpen(true)}>New user</Button>}
      />
      <Users departments={departments} newOpen={newOpen} setNewOpen={setNewOpen} />
    </>
  ) : (
    <>
      <PageHeader title="Handover templates" subtitle="Per-department checklist definitions. Every save creates a new version; earlier versions are kept." />
      <Templates departments={departments} />
    </>
  );
}
