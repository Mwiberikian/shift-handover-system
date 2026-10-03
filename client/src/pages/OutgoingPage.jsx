import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import {
  ErrorBox, HandoverDetail, IncidentTable, RecordTable, StatusBadge, TaskTable, fmt,
} from '../components/Handover';
import PageHeader from '../components/ui/PageHeader';

// Live checklist of the department template's mandatory fields.
function TemplateChecklist({ template, record, notes, incoming }) {
  const counts = { tasks: record.tasks.length, incidents: record.incidents.length };
  return (
    <ul className="checklist">
      {template.field_definition.fields.map((f) => {
        let ok = true;
        let hint = '';
        if (f.key === 'summary_notes') {
          const len = notes.trim().length;
          ok = !f.required || len >= Math.max(1, f.minLength || 0);
          hint = f.minLength ? `${len}/${f.minLength} characters` : '';
        } else {
          const min = f.minItems ?? 1;
          ok = !f.required || counts[f.key] >= min;
          hint = `${counts[f.key]} added${f.required ? `, ${min} required` : ''}`;
        }
        return (
          <li key={f.key} className={ok ? 'ok' : 'missing'}>
            {ok ? '✔' : '✘'} {f.label} {f.required ? '' : <span className="muted">(optional)</span>}
            {hint && <span className="muted small"> — {hint}</span>}
          </li>
        );
      })}
      <li className={incoming ? 'ok' : 'missing'}>
        {incoming ? '✔' : '✘'} Incoming staff member assigned
      </li>
    </ul>
  );
}

function DraftEditor({ record, meta, reload, onSubmitted }) {
  const [notes, setNotes] = useState(record.summary_notes || '');
  const [incoming, setIncoming] = useState(record.incoming_user_id || '');
  const [task, setTask] = useState({ description: '', priority: 'medium' });
  const [incident, setIncident] = useState({ title: '', description: '', severity: 'low', occurred_at: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const run = async (fn, ok) => {
    setError('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const save = () => run(() => api.patch(`/handovers/${record.record_id}`, {
    summary_notes: notes, incoming_user_id: incoming || null,
  }), 'Draft saved.');

  const addTask = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post(`/handovers/${record.record_id}/tasks`, task);
      setTask({ description: '', priority: 'medium' });
    });
  };

  const addIncident = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post(`/handovers/${record.record_id}/incidents`, {
        ...incident, occurred_at: new Date(incident.occurred_at).toISOString(),
      });
      setIncident({ title: '', description: '', severity: 'low', occurred_at: '' });
    });
  };

  const setTaskStatus = (t, status) => run(() => api.patch(`/handovers/${record.record_id}/tasks/${t.task_id}`, { status }));

  const submit = () => run(async () => {
    // Save unsaved form edits first so the server validates what the user sees.
    await api.patch(`/handovers/${record.record_id}`, { summary_notes: notes, incoming_user_id: incoming || null });
    const { data } = await api.post(`/handovers/${record.record_id}/submit`);
    // The editor unmounts once the record leaves 'draft', so report via the page.
    onSubmitted(`Handover submitted and locked. ${data.carried_forward} task(s) carried forward from the previous shift; ${data.notified.length} people notified.`);
  });

  return (
    <div className="grid-2">
      <section className="card">
        <h3>Draft handover <StatusBadge status={record.status} /></h3>
        <p className="muted small">{record.department_name} · {record.shift_type} shift starting {fmt(record.shift_start)}</p>
        <label>
          Incoming staff member
          <select value={incoming} onChange={(e) => setIncoming(e.target.value)}>
            <option value="">— select —</option>
            {meta.incoming_staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.staff_number})</option>)}
          </select>
        </label>
        <label>
          Summary notes
          <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="button" onClick={save}>Save draft</button>

        <h4>Tasks</h4>
        <TaskTable
          tasks={record.tasks}
          actions={(t) => (
            <select value={t.status} onChange={(e) => setTaskStatus(t, e.target.value)}>
              <option value="open">open</option>
              <option value="in_progress">in progress</option>
              <option value="resolved">resolved</option>
            </select>
          )}
        />
        <form className="inline" onSubmit={addTask}>
          <input placeholder="Task description" value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} required />
          <select value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })}>
            <option>low</option><option>medium</option><option>high</option>
          </select>
          <button type="submit">Add task</button>
        </form>

        <h4>Incidents</h4>
        <IncidentTable incidents={record.incidents} />
        <form className="stack" onSubmit={addIncident}>
          <input placeholder="Incident title" value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} required />
          <textarea rows={2} placeholder="Description (optional)" value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} />
          <div className="inline">
            <select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}>
              <option>low</option><option>medium</option><option>high</option><option>critical</option>
            </select>
            <input type="datetime-local" value={incident.occurred_at} onChange={(e) => setIncident({ ...incident, occurred_at: e.target.value })} required />
            <button type="submit">Add incident</button>
          </div>
        </form>
      </section>

      <aside className="card">
        <h3>Template requirements</h3>
        <p className="muted small">{record.department_code} template v{meta.template.version}</p>
        <TemplateChecklist template={meta.template} record={record} notes={notes} incoming={incoming} />
        <ErrorBox error={error} />
        {msg && <div className="success">{msg}</div>}
        <button type="button" className="primary" onClick={submit}>Submit handover</button>
        <p className="muted small">Once submitted the record is locked and cannot be edited.</p>
      </aside>
    </div>
  );
}

function ClarifyBox({ record, reload }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/handovers/${record.record_id}/clarify`, { comments: text });
      setText('');
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form className="card warn" onSubmit={send}>
      <h4>The incoming staff member raised a query</h4>
      <p>{record.acknowledgement?.comments}</p>
      <textarea rows={3} placeholder="Your clarification" value={text} onChange={(e) => setText(e.target.value)} required />
      <ErrorBox error={error} />
      <button type="submit" className="primary">Send clarification</button>
    </form>
  );
}

export default function OutgoingPage({ view }) {
  const [meta, setMeta] = useState(null);
  const [records, setRecords] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const reload = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([api.get('/handovers/meta'), api.get('/handovers')]);
      setMeta(m.data);
      setRecords(list.data);
      const active = list.data.find((r) => r.shift_id === m.data.current_shift?.shift_id && r.status !== 'closed');
      setCurrent(active ? (await api.get(`/handovers/${active.record_id}`)).data : null);
      if (selected) setSelected((await api.get(`/handovers/${selected.record_id}`)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [selected]);

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError('');
    try {
      await api.post('/handovers', {});
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!meta) return <><ErrorBox error={error} /><p>Loading…</p></>;
  const queried = records.filter((r) => r.status === 'queried');

  return (
    <>
      <PageHeader
        title={view === 'history' ? 'My handovers' : 'Current handover'}
        subtitle={view === 'history' ? 'Every handover you have prepared, newest first.' : 'Prepare and submit the handover for your current shift.'}
      />
      <ErrorBox error={error} />
      {flash && <div className="success">{flash}</div>}
      {view === 'current' && (<>
      {queried.map((r) => (
        <QueriedLoader key={r.record_id} id={r.record_id} reload={reload} />
      ))}

      {!meta.current_shift && <p className="error">No shift is currently active for your department.</p>}
      {meta.current_shift && !current && (
        <div className="card">
          <p>No handover yet for the current {meta.current_shift.shift_type} shift ({fmt(meta.current_shift.start_time)} – {fmt(meta.current_shift.end_time)}).</p>
          <button type="button" className="primary" onClick={start}>Start handover</button>
        </div>
      )}
      {current?.status === 'draft' && <DraftEditor key={current.record_id} record={current} meta={meta} reload={reload} onSubmitted={setFlash} />}
      {current && current.status !== 'draft' && (
        <div className="card"><HandoverDetail record={current} /></div>
      )}

      </>)}
      {view === 'history' && (<>
      <RecordTable
        records={records}
        selectedId={selected?.record_id}
        onSelect={async (id) => setSelected((await api.get(`/handovers/${id}`)).data)}
      />
      {selected && <div className="card"><HandoverDetail record={selected} /></div>}
      </>)}
    </>
  );
}

// Fetches a queried record's detail so the clarify box can show the query text.
function QueriedLoader({ id, reload }) {
  const [record, setRecord] = useState(null);
  useEffect(() => { api.get(`/handovers/${id}`).then((r) => setRecord(r.data)); }, [id]);
  return record ? <ClarifyBox record={record} reload={reload} /> : null;
}
