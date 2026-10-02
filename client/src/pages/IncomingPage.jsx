import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { ErrorBox, HandoverDetail, RecordTable } from '../components/Handover';

function AcknowledgeBox({ record, onDone }) {
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');

  const act = async (action) => {
    setError('');
    try {
      const path = action === 'ack' ? 'acknowledgement' : 'query';
      const { data } = await api.post(`/handovers/${record.record_id}/${path}`, { comments: comments || undefined });
      setComments('');
      onDone(data.record_id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="card">
      <h4>Your response</h4>
      <p className="muted small">
        Acknowledge to confirm you have received and understood this handover, or raise a query
        if anything is unclear (the outgoing staff member will be notified).
      </p>
      <textarea rows={3} placeholder="Comments (required for a query)" value={comments} onChange={(e) => setComments(e.target.value)} />
      <ErrorBox error={error} />
      <div className="inline">
        <button type="button" className="primary" onClick={() => act('ack')}>Acknowledge</button>
        <button type="button" onClick={() => act('query')}>Raise query</button>
      </div>
    </div>
  );
}

export default function IncomingPage() {
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const loadList = () => api.get('/handovers').then((r) => setRecords(r.data)).catch((e) => setError(errorMessage(e)));
  const open = async (id) => {
    setError('');
    try {
      setSelected((await api.get(`/handovers/${id}`)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => { loadList(); }, []);

  const pending = records.filter((r) => r.status === 'submitted');
  return (
    <>
      <h2>Incoming handovers</h2>
      <ErrorBox error={error} />
      {pending.length > 0 && <div className="success">{pending.length} handover(s) awaiting your acknowledgement.</div>}
      <RecordTable records={records} onSelect={open} selectedId={selected?.record_id} empty="No handovers have been assigned to you." />
      {selected && (
        <>
          <div className="card"><HandoverDetail record={selected} /></div>
          {selected.status === 'submitted' && (
            <AcknowledgeBox record={selected} onDone={(id) => { loadList(); open(id); }} />
          )}
          {selected.status === 'queried' && <p className="muted">Waiting for the outgoing staff member to answer your query.</p>}
        </>
      )}
    </>
  );
}
