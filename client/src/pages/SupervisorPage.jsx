import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { ErrorBox, HandoverDetail, RecordTable, fmt } from '../components/Handover';
import PageHeader from '../components/ui/PageHeader';

const STATUSES = ['draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed'];

function Dashboard({ data }) {
  return (
    <>
      {data.departments.map((d) => (
        <div key={d.department_id} className="stats">
          <h3>{d.name}</h3>
          {[
            ['Open', d.open], ['Submitted', d.submitted], ['Queried', d.queried],
            ['Acknowledged', d.acknowledged], ['Escalated', d.escalated], ['Closed', d.closed],
          ].map(([label, n]) => (
            <div key={label} className="stat"><div className="n">{n}</div><div className="muted small">{label}</div></div>
          ))}
          <div className={`stat ${d.unacknowledged_overdue ? 'alert' : ''}`}>
            <div className="n">{d.unacknowledged_overdue}</div>
            <div className="small">Unacknowledged &gt; {data.threshold_hours}h</div>
          </div>
        </div>
      ))}
      {data.unacknowledged_alerts.length > 0 && (
        <div className="card alert-box">
          <h4>⚠ Unacknowledged beyond {data.threshold_hours} hours after shift start</h4>
          <ul>
            {data.unacknowledged_alerts.map((a) => (
              <li key={a.record_id}>
                {a.shift_type} shift {fmt(a.shift_start)} — {a.outgoing_name} → {a.incoming_name ?? 'unassigned'} ·
                status <strong>{a.status}</strong> · {a.hours_since_shift_start}h since shift start
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ReviewBox({ record, onDone }) {
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');

  const act = async (path, body) => {
    setError('');
    try {
      await api.post(`/handovers/${record.record_id}/${path}`, { ...body, comments: comments || undefined });
      setComments('');
      onDone(record.record_id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!['acknowledged', 'escalated'].includes(record.status)) return null;
  return (
    <div className="card">
      <h4>{record.status === 'acknowledged' ? 'Supervisor review' : 'Resolve escalation'}</h4>
      <textarea rows={3} placeholder="Comments" value={comments} onChange={(e) => setComments(e.target.value)} />
      <ErrorBox error={error} />
      <div className="inline">
        {record.status === 'acknowledged' ? (
          <>
            <button type="button" className="primary" onClick={() => act('review', { decision: 'approved' })}>Approve &amp; close</button>
            <button type="button" className="danger" onClick={() => act('review', { decision: 'escalated' })}>Escalate</button>
          </>
        ) : (
          <button type="button" className="primary" onClick={() => act('resolve', {})}>Mark resolved &amp; close</button>
        )}
      </div>
    </div>
  );
}

function Search({ onSelect, selectedId }) {
  const [q, setQ] = useState({ q: '', status: '', from: '', to: '' });
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const run = async (e) => {
    e.preventDefault();
    setError('');
    const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
    if (params.to) params.to = `${params.to}T23:59:59`;
    try {
      setResults((await api.get('/handovers/search', { params })).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section>
      <form className="inline" onSubmit={run}>
        <input placeholder="Keyword (summary or task)" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} />
        <select value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })}>
          <option value="">any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="inline-label">From <input type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} /></label>
        <label className="inline-label">To <input type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></label>
        <button type="submit">Search</button>
      </form>
      <ErrorBox error={error} />
      {results && <RecordTable records={results} onSelect={onSelect} selectedId={selectedId} empty="No matching records." />}
    </section>
  );
}

const TITLES = {
  overview: ['Overview', 'Handover status across your departments.'],
  queue: ['Review queue', 'Acknowledged handovers awaiting supervisor review.'],
  escalated: ['Escalated', 'Handovers escalated for resolution.'],
  search: ['Search', 'Find handover records by keyword, status or date.'],
};

export default function SupervisorPage({ view }) {
  const [dash, setDash] = useState(null);
  const [queue, setQueue] = useState([]);
  const [escalated, setEscalated] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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
      setError(errorMessage(err));
    }
  }, []);

  const open = async (id) => {
    try {
      setSelected((await api.get(`/handovers/${id}`)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title={TITLES[view][0]} subtitle={TITLES[view][1]} actions={<button type="button" onClick={load}>Refresh</button>} />
      <ErrorBox error={error} />
      {view === 'overview' && dash && <Dashboard data={dash} />}
      {view === 'queue' && <RecordTable records={queue} onSelect={open} selectedId={selected?.record_id} empty="Nothing awaiting review." />}
      {view === 'escalated' && <RecordTable records={escalated} onSelect={open} selectedId={selected?.record_id} empty="No escalated records." />}
      {view === 'search' && <Search onSelect={open} selectedId={selected?.record_id} />}

      {selected && (
        <>
          <div className="card">
            <HandoverDetail record={selected} />
            {selected.reviews?.length > 0 && (
              <>
                <h4>Reviews</h4>
                <ul className="thread">
                  {selected.reviews.map((r) => (
                    <li key={r.review_id}><strong>{r.decision}</strong> by {r.supervisor_name} · {fmt(r.reviewed_at)}{r.comments && <div>{r.comments}</div>}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <ReviewBox record={selected} onDone={(id) => { load(); open(id); }} />
        </>
      )}
    </>
  );
}
