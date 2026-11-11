// Phase 2: supervisor actions on a HELD report — Approve (release it) or
// Send back with a note (returns it to the outgoing author through the
// existing 'queried' flow). Shown only while record.release_state === 'held'.
import { useState } from 'react';
import { ShieldCheck, Undo2 } from 'lucide-react';
import api from '../api';
import { Button, Callout, Modal, Textarea } from './ui';
import useAction from '../lib/useAction';

export default function HoldActions({ record, onDone }) {
  const [dialog, setDialog] = useState(null); // 'approve' | 'send-back' | null
  const [comments, setComments] = useState('');
  const [run, busy] = useAction();

  if (record?.release_state !== 'held') return null;
  const reasons = record.release_reasons || [];

  const close = () => { if (!busy) { setDialog(null); setComments(''); } };
  const act = async (path, body, success) => {
    const ok = await run(() => api.post(`/handovers/${record.record_id}/${path}`, body), success);
    if (ok) {
      setDialog(null);
      setComments('');
      onDone(record.record_id);
    }
  };

  return (
    <div className="space-y-3">
      <Callout tone="warning" icon={ShieldCheck} title="Held for your approval">
        {reasons.length
          ? <ul className="list-disc space-y-0.5 pl-5">{reasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
          : 'This report was held for approval.'}
      </Callout>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button icon={Undo2} disabled={busy} onClick={() => setDialog('send-back')}>Send back with a note</Button>
        <Button variant="primary" icon={ShieldCheck} loading={busy && dialog !== 'send-back'} onClick={() => act('approve', {}, 'Report approved and released')}>
          Approve &amp; release
        </Button>
      </div>

      <Modal
        open={dialog === 'send-back'}
        onClose={close}
        title="Send back with a note"
        description="The outgoing staff member is notified and asked to answer. The report stays held until a supervisor approves it."
        footer={(
          <>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={Undo2} loading={busy} disabled={!comments.trim()} onClick={() => act('send-back', { comments: comments.trim() }, 'Report sent back to the outgoing staff member')}>
              Send back
            </Button>
          </>
        )}
      >
        <Textarea label="What needs attention?" required rows={4} value={comments} onChange={(e) => setComments(e.target.value)} data-autofocus />
      </Modal>
    </div>
  );
}
