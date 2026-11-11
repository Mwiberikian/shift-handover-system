import { useEffect, useState } from 'react';
import { UserCog } from 'lucide-react';
import api from '../api';
import { Button, Callout } from './ui';

// Phase 1, interim: after a supervisor switched the user's duty they were
// signed out (their token became invalid), and the switch wrote a
// 'role_changed' notification. This shows that note once, on the next page
// load after signing back in; dismissing marks the notification read.
export default function RoleChangeNote() {
  const [note, setNote] = useState(null);
  useEffect(() => {
    api.get('/notifications')
      .then((r) => setNote(r.data.find((n) => n.type === 'role_changed' && !n.read_at) ?? null))
      .catch(() => {});
  }, []);

  if (!note) return null;
  const dismiss = () => {
    api.post(`/notifications/${note.notification_id}/read`).catch(() => {});
    setNote(null);
  };
  return (
    <Callout
      tone="info"
      icon={UserCog}
      className="mb-6"
      title={note.title ?? 'Your duty was changed'}
      action={<Button size="sm" onClick={dismiss}>Dismiss</Button>}
    >
      {note.body}
    </Callout>
  );
}
