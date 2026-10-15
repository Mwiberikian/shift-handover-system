import { useEffect, useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Button, Checkbox, Input, Modal,
} from '../ui';
import { ROLE_LABEL } from '../../lib/format';
import useAction from '../../lib/useAction';

const WORKERS = ['outgoing_staff', 'incoming_staff'];

// Share a submitted report. The picker lists only the people the server says
// the caller may share with (GET /api/reports/share-candidates): for staff,
// colleagues in their department and supervisors; for supervisors and
// admins, any active user. People it was already shared with are ticked and
// fixed (sharing cannot be undone).
export default function ShareDialog({ report, open, onClose, onShared }) {
  const { claims } = useAuth();
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setQuery('');
    setEmail(false);
    api.get('/reports/share-candidates').then((r) => setCandidates(r.data)).catch(() => setCandidates([]));
  }, [open]);

  const already = useMemo(() => new Set((report.shares ?? []).map((s) => s.user_id)), [report.shares]);
  const shown = (candidates ?? [])
    .filter((c) => c.user_id !== report.author_id)
    .filter((c) => !query || `${c.full_name} ${c.department_name ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const share = () => run(async () => {
    const { data } = await api.post(`/reports/${report.report_id}/share`, { user_ids: [...picked], email });
    onShared?.(data);
    onClose();
  }, `Shared with ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Share report"
      description={WORKERS.includes(claims.role)
        ? 'You can share with colleagues in your department and with supervisors.'
        : 'You can share with any active user.'}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Share2} loading={busy} disabled={!picked.size} onClick={share}>
            Share{picked.size ? ` with ${picked.size}` : ''}
          </Button>
        </>
      )}
    >
      <Input label="Find a person" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or department" />
      <fieldset className="mt-3">
        <legend className="sr-only">Recipients</legend>
        {candidates === null && <p className="py-3 text-ink-600">Loading…</p>}
        {candidates !== null && !shown.length && <p className="py-3 text-ink-600">No one matches.</p>}
        <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto">
          {shown.map((c) => (
            <li key={c.user_id}>
              <Checkbox
                label={c.full_name}
                description={`${ROLE_LABEL[c.role] ?? c.role}${c.department_name ? ` · ${c.department_name}` : ''}${already.has(c.user_id) ? ' · already shared' : ''}`}
                checked={already.has(c.user_id) || picked.has(c.user_id)}
                disabled={already.has(c.user_id)}
                onChange={() => toggle(c.user_id)}
              />
            </li>
          ))}
        </ul>
      </fieldset>
      <Checkbox
        className="mt-3 border-t border-ink-200 pt-2"
        label="Also send an email alert"
        description="The email has the report title and a link only, never the report text."
        checked={email}
        onChange={(e) => setEmail(e.target.checked)}
      />
    </Modal>
  );
}
