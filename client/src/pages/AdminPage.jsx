import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { ErrorBox } from '../components/Handover';

const ROLES = ['outgoing_staff', 'incoming_staff', 'supervisor', 'admin'];
const EMPTY_USER = { staff_number: '', full_name: '', email: '', password: '', role: 'outgoing_staff', department_id: '' };

function UserRow({ user, departments, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');

  const save = async (patch) => {
    setError('');
    try {
      await api.patch(`/admin/users/${user.user_id}`, patch);
      setEdit(null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <tr className={user.is_active ? '' : 'inactive'}>
      <td>{user.staff_number}</td>
      <td>{user.full_name}<div className="muted small">{user.email}</div></td>
      <td>
        {edit ? (
          <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        ) : user.role}
      </td>
      <td>
        {edit ? (
          <select value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}>
            <option value="">— none —</option>
            {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
          </select>
        ) : (user.department_name ?? '—')}
      </td>
      <td>{user.is_active ? 'active' : 'inactive'}</td>
      <td className="actions">
        {edit ? (
          <>
            <button type="button" onClick={() => save({ role: edit.role, department_id: edit.department_id || null })}>Save</button>
            <button type="button" onClick={() => setEdit(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEdit({ role: user.role, department_id: user.department_id || '' })}>Edit</button>
            {user.is_active
              ? <button type="button" className="danger" onClick={() => save({ is_active: false })}>Deactivate</button>
              : <button type="button" onClick={() => save({ is_active: true })}>Reactivate</button>}
          </>
        )}
        <ErrorBox error={error} />
      </td>
    </tr>
  );
}

function Users({ departments }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY_USER);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/admin/users').then((r) => setUsers(r.data)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/admin/users', { ...form, department_id: form.department_id || null });
      setForm(EMPTY_USER);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const field = (name, props = {}) => (
    <input placeholder={name.replace('_', ' ')} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} required {...props} />
  );

  return (
    <>
      <form className="card inline wrap" onSubmit={create}>
        <strong>New account</strong>
        {field('staff_number')}
        {field('full_name')}
        {field('email', { type: 'email' })}
        {field('password', { type: 'password', minLength: 8 })}
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
          <option value="">— department —</option>
          {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
        </select>
        <button type="submit" className="primary">Create</button>
      </form>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Staff #</th><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th /></tr></thead>
          <tbody>
            {users.map((u) => <UserRow key={u.user_id} user={u} departments={departments} onSaved={load} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Structured editor: one row per template key (summary_notes, tasks, incidents).
const KEY_INFO = {
  summary_notes: { type: 'text', minKey: 'minLength', minLabel: 'Min characters' },
  tasks: { type: 'list', minKey: 'minItems', minLabel: 'Min items' },
  incidents: { type: 'list', minKey: 'minItems', minLabel: 'Min items' },
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

function Templates({ departments }) {
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [viewVersion, setViewVersion] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async (c) => {
    setError('');
    try {
      const { data: d } = await api.get(`/admin/templates/${c}`);
      setData(d);
      setRows(toRows(d.template.field_definition));
      setViewVersion(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!code && departments.length) setCode(departments[0].code);
  }, [departments, code]);
  useEffect(() => { if (code) load(code); }, [code, load]);

  const update = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setError('');
    setMsg('');
    try {
      const { data: res } = await api.put(`/admin/templates/${code}`, { field_definition: fromRows(rows) });
      setMsg(res.changed ? `Saved as version ${res.template.version}. Previous versions are kept.` : 'No changes — version unchanged.');
      load(code);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const shown = viewVersion && data?.versions.find((v) => v.version === viewVersion);

  return (
    <>
      <label className="inline-label">
        Department{' '}
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {departments.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
        </select>
      </label>
      {data && (
        <div className="grid-2">
          <section className="card">
            <h3>Current template — v{data.current_version}</h3>
            <table>
              <thead><tr><th>Use</th><th>Field</th><th>Label</th><th>Required</th><th>Minimum</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td><input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></td>
                    <td><code>{r.key}</code></td>
                    <td><input value={r.label} disabled={!r.enabled} onChange={(e) => update(i, { label: e.target.value })} /></td>
                    <td><input type="checkbox" checked={r.required} disabled={!r.enabled} onChange={(e) => update(i, { required: e.target.checked })} /></td>
                    <td>
                      <input type="number" min="0" className="narrow" placeholder={KEY_INFO[r.key].minLabel} value={r.min} disabled={!r.enabled} onChange={(e) => update(i, { min: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ErrorBox error={error} />
            {msg && <div className="success">{msg}</div>}
            <button type="button" className="primary" onClick={save}>Save as new version</button>
          </section>
          <aside className="card">
            <h3>Version history</h3>
            <ul className="versions">
              {data.versions.map((v) => (
                <li key={v.template_id}>
                  <button type="button" className="link" onClick={() => setViewVersion(v.version)}>v{v.version}</button>
                  {v.version === data.current_version && <span className="badge status-acknowledged">current</span>}
                </li>
              ))}
            </ul>
            {shown && <pre>{JSON.stringify(shown.field_definition, null, 2)}</pre>}
          </aside>
        </div>
      )}
    </>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('users');
  const [departments, setDepartments] = useState([]);
  useEffect(() => { api.get('/admin/departments').then((r) => setDepartments(r.data)); }, []);

  return (
    <>
      <h2>Administration</h2>
      <div className="tabs">
        <button type="button" className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
        <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Templates</button>
      </div>
      {tab === 'users' ? <Users departments={departments} /> : <Templates departments={departments} />}
    </>
  );
}
