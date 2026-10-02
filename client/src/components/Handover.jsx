// Shared, read-only building blocks for displaying handover records.

export const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{status?.replace('_', ' ')}</span>;
}

export function ErrorBox({ error }) {
  return error ? <div className="error">{error}</div> : null;
}

export function RecordTable({ records, onSelect, selectedId, empty = 'No records.' }) {
  if (!records.length) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Shift</th><th>Dept</th><th>Outgoing</th><th>Incoming</th><th>Status</th><th>Submitted</th></tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.record_id}
              className={`${onSelect ? 'clickable' : ''} ${selectedId === r.record_id ? 'selected' : ''}`}
              onClick={onSelect ? () => onSelect(r.record_id) : undefined}
            >
              <td>{r.shift_type} · {fmt(r.shift_start)}</td>
              <td>{r.department_code}</td>
              <td>{r.outgoing_name ?? '—'}</td>
              <td>{r.incoming_name ?? '—'}</td>
              <td><StatusBadge status={r.status} /></td>
              <td>{fmt(r.submitted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskTable({ tasks, actions }) {
  if (!tasks.length) return <p className="muted">No tasks.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th />{actions && <th />}</tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.task_id}>
              <td>{t.description}</td>
              <td><span className={`badge prio-${t.priority}`}>{t.priority}</span></td>
              <td>{t.status.replace('_', ' ')}</td>
              <td>{t.carried_from_task_id && <span className="badge carried" title={`From record ${t.carried_from_record_id}`}>carried forward</span>}</td>
              {actions && <td>{actions(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IncidentTable({ incidents }) {
  if (!incidents.length) return <p className="muted">No incidents.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Incident</th><th>Severity</th><th>Occurred</th><th>Reported by</th></tr></thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.incident_id}>
              <td><strong>{i.title}</strong>{i.description && <div className="muted small">{i.description}</div>}</td>
              <td><span className={`badge sev-${i.severity}`}>{i.severity}</span></td>
              <td>{fmt(i.occurred_at)}</td>
              <td>{i.reported_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const THREAD_LABEL = {
  query: 'Query raised',
  clarify: 'Clarification',
  acknowledge: 'Acknowledged',
  review: 'Supervisor review',
  resolve: 'Escalation resolved',
};

// Full record view used by the incoming and supervisor dashboards.
export function HandoverDetail({ record }) {
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{record.department_name} · {record.shift_type} shift {fmt(record.shift_start)}</h3>
        <StatusBadge status={record.status} />
      </div>
      <p className="muted small">
        Outgoing: {record.outgoing_name ?? '—'} · Incoming: {record.incoming_name ?? '—'} ·
        Submitted: {fmt(record.submitted_at)}{record.closed_at && ` · Closed: ${fmt(record.closed_at)}`}
        {record.template && ` · Template v${record.template.version}`}
      </p>

      <h4>Summary</h4>
      <p className="notes">{record.summary_notes || <span className="muted">No summary.</span>}</p>

      <h4>Tasks</h4>
      <TaskTable tasks={record.tasks} />

      <h4>Incidents</h4>
      <IncidentTable incidents={record.incidents} />

      {record.thread?.length > 0 && (
        <>
          <h4>History</h4>
          <ul className="thread">
            {record.thread.map((t, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i}>
                <strong>{THREAD_LABEL[t.action] || t.action}</strong> by {t.by_name} · <span className="muted">{fmt(t.logged_at)}</span>
                {t.comments && <div>{t.comments}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
