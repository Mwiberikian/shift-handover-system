import { useEffect, useState } from 'react';
import { CalendarSync, Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import api from '../../api';
import { Button, Callout, Modal } from '../ui';
import { formatEAT } from '../../lib/format';
import { toast } from '../../lib/toast';
import useAction from '../../lib/useAction';

// Private calendar subscription URL (Part K). The API returns the URL only
// when it is created; afterwards only "active since" is known. Revoking or
// regenerating makes the old URL stop working at once.
export default function CalendarFeedDialog({ open, onClose }) {
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (!open) return;
    setUrl(null);
    setCopied(false);
    api.get('/auth/me/calendar-feed').then((r) => setStatus(r.data)).catch(() => setStatus({ active: false }));
  }, [open]);

  const create = () => run(async () => {
    const { data } = await api.post('/auth/me/calendar-feed');
    setStatus({ active: true, created_at: data.created_at });
    setUrl(data.url);
  }, status?.active ? 'New feed link created; the old one no longer works' : 'Feed link created');

  const revoke = () => run(async () => {
    setStatus((await api.delete('/auth/me/calendar-feed')).data);
    setUrl(null);
  }, 'Feed link revoked');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Calendar subscription"
      description="Your rostered shifts in your own calendar app, kept up to date."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4 text-body">
        <p className="text-ink-700">
          The feed lists your shifts from 30 days ago to 90 days ahead: shift name, times and department, with a reminder
          30 minutes before each. It never includes handover details.
        </p>

        {url && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink-800">Your private feed link (shown only now)</p>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-100 px-3 py-2.5 font-mono text-meta text-fg select-all" title={url}>{url}</code>
              <Button icon={copied ? Check : Copy} onClick={copy} aria-label="Copy feed link">{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="text-meta text-ink-600">
              In Google Calendar: Other calendars, From URL. In Outlook: Add calendar, Subscribe from web. Or open it as{' '}
              <a className="font-medium text-accent-fg underline" href={url.replace(/^https?:/, 'webcal:')}>webcal</a>.
            </p>
            <Callout tone="warning">Anyone with this link can see your shift times. Do not share it. Revoke it if it leaks.</Callout>
          </div>
        )}

        {status === null ? <p className="text-ink-600">Loading…</p> : status.active ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto flex items-center gap-1.5 text-ink-700">
              <CalendarSync aria-hidden className="size-4" /> Active since {formatEAT(status.created_at)}
            </p>
            <Button icon={RefreshCw} onClick={create} loading={busy}>New link</Button>
            <Button variant="danger" icon={Trash2} onClick={revoke} disabled={busy}>Revoke</Button>
          </div>
        ) : (
          <Button variant="primary" icon={CalendarSync} onClick={create} loading={busy}>Create my feed link</Button>
        )}
      </div>
    </Modal>
  );
}
