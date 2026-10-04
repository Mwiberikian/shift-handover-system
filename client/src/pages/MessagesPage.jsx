import { useCallback, useEffect, useState } from 'react';
import {
  CheckCheck, Inbox, Megaphone, PenSquare, Reply, Send, User, Users,
} from 'lucide-react';
import api from '../api';
import ComposeDialog from '../components/messages/ComposeDialog';
import {
  Badge, Button, Card, Drawer, EmptyState, PageHeader, SkeletonTable,
} from '../components/ui';
import {
  ROLE_LABEL, cx, fmt, fmtRelative, initials,
} from '../lib/format';
import { refreshUnread, useUnreadMessages } from '../lib/unread';
import { toastError } from '../lib/toast';

function AudienceBadge({ m }) {
  if (m.recipient_type === 'organisation') return <Badge tone="amber" icon={Megaphone}>Everyone</Badge>;
  if (m.recipient_type === 'department') return <Badge tone="blue" icon={Users}>{m.recipient_department_name}</Badge>;
  return <Badge tone="gray" icon={User}>Direct</Badge>;
}

const recipientLabel = (m) => (m.recipient_type === 'user' ? m.recipient_name
  : m.recipient_type === 'department' ? m.recipient_department_name : 'Everyone');

function MessageRow({ m, box, onOpen }) {
  const unread = box === 'inbox' && m.unread;
  const who = box === 'inbox' ? m.sender_name : `To ${recipientLabel(m)}`;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(m)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 sm:px-5"
      >
        <span aria-hidden className={cx('mt-2 size-2 shrink-0 rounded-full', unread ? 'bg-brand-red' : 'bg-transparent')} />
        <span aria-hidden className="hidden size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-meta font-semibold text-ink-700 sm:grid">
          {initials(box === 'inbox' ? m.sender_name : recipientLabel(m))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('truncate', unread ? 'font-semibold text-fg' : 'font-medium text-ink-800')}>{who}</span>
            <AudienceBadge m={m} />
            {unread && <span className="sr-only">(unread)</span>}
          </span>
          <span className={cx('mt-0.5 block truncate', unread ? 'text-fg' : 'text-ink-700')}>
            {m.subject ? <span className="font-medium">{m.subject} — </span> : null}
            <span className="text-ink-600">{m.body}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-meta text-ink-600">
          <span title={fmt(m.created_at)}>{fmtRelative(m.created_at)}</span>
          {box === 'sent' && m.recipient_type === 'user' && (
            m.recipient_read_at
              ? <span className="inline-flex items-center gap-1 text-status-green"><CheckCheck aria-hidden className="size-3.5" />Read</span>
              : <span>Delivered</span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function MessagesPage() {
  const [box, setBox] = useState('inbox');
  const [data, setData] = useState(null); // { items, total, page }
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState(null);
  const [compose, setCompose] = useState(null); // null | {} | reply preset
  const unread = useUnreadMessages();

  const load = useCallback(async (page = 1) => {
    try {
      const { data: d } = await api.get(`/messages/${box}`, { params: { page, page_size: 20 } });
      setData((prev) => (page === 1 ? d : { ...d, items: [...prev.items, ...d.items] }));
    } catch (err) {
      toastError(err);
      setData((prev) => prev ?? { items: [], total: 0, page: 1 });
    }
  }, [box]);

  useEffect(() => { setData(null); load(1); }, [load]);

  // Newly arrived messages show up when the 30-second unread poll changes.
  useEffect(() => { if (box === 'inbox' && data) load(1); }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMessage = async (m) => {
    setOpen(m);
    if (box === 'inbox' && m.unread) {
      try {
        await api.post(`/messages/${m.message_id}/read`);
        setData((d) => ({ ...d, items: d.items.map((x) => (x.message_id === m.message_id ? { ...x, unread: false } : x)) }));
        refreshUnread();
      } catch (err) {
        toastError(err);
      }
    }
  };

  const more = async () => {
    setLoadingMore(true);
    await load(data.page + 1);
    setLoadingMore(false);
  };

  const reply = (m) => {
    setOpen(null);
    setCompose({
      type: 'user',
      person: { user_id: m.sender_id, full_name: m.sender_name },
      subject: m.subject ? (m.subject.startsWith('Re: ') ? m.subject : `Re: ${m.subject}`).slice(0, 160) : '',
    });
  };

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Direct messages, department notices and organisation-wide announcements."
        actions={<Button variant="primary" icon={PenSquare} onClick={() => setCompose({})}>New message</Button>}
      />

      <Card flush>
        <div role="group" aria-label="Folder" className="flex gap-1 border-b border-ink-200 px-3 pt-3">
          {[['inbox', 'Inbox', Inbox], ['sent', 'Sent', Send]].map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={box === value}
              onClick={() => setBox(value)}
              className={cx(
                '-mb-px inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                box === value ? 'border-brand-red text-fg' : 'border-transparent text-ink-600 hover:text-fg',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
              {value === 'inbox' && unread > 0 && (
                <span className="rounded-full bg-brand-red-dark px-1.5 text-meta font-semibold text-white tabular-nums">
                  {unread}<span className="sr-only"> unread</span>
                </span>
              )}
            </button>
          ))}
        </div>

        {data === null ? <SkeletonTable rows={5} cols={3} /> : data.items.length === 0 ? (
          box === 'inbox'
            ? <EmptyState icon={Inbox} title="No messages yet" message="Direct messages and notices for your department appear here." action={<Button icon={PenSquare} onClick={() => setCompose({})}>Write a message</Button>} />
            : <EmptyState icon={Send} title="Nothing sent yet" message="Messages you send appear here, with read receipts for direct messages." />
        ) : (
          <>
            <ul className="divide-y divide-ink-100">
              {data.items.map((m) => <MessageRow key={m.message_id} m={m} box={box} onOpen={openMessage} />)}
            </ul>
            {data.items.length < data.total && (
              <div className="border-t border-ink-200 p-3 text-center">
                <Button size="sm" variant="ghost" loading={loadingMore} onClick={more}>
                  Load older messages ({data.total - data.items.length} more)
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.subject || 'Message'}
        footer={open && box === 'inbox' ? (
          <div className="flex justify-end"><Button variant="primary" icon={Reply} onClick={() => reply(open)}>Reply to {open.sender_name}</Button></div>
        ) : null}
      >
        {open && (
          <article className="space-y-5">
            <dl className="grid gap-3 rounded-lg bg-ink-50 px-4 py-3 sm:grid-cols-2">
              <div>
                <dt className="text-meta font-medium text-ink-600">From</dt>
                <dd className="text-fg">{open.sender_name}</dd>
                <dd className="text-meta text-ink-600">{ROLE_LABEL[open.sender_role]}{open.sender_department_name && ` · ${open.sender_department_name}`}</dd>
              </div>
              <div>
                <dt className="text-meta font-medium text-ink-600">To</dt>
                <dd className="flex flex-wrap items-center gap-2 text-fg">{recipientLabel(open)} <AudienceBadge m={open} /></dd>
                <dd className="text-meta text-ink-600">{fmt(open.created_at)}</dd>
              </div>
            </dl>
            {/* Plain text only: React escapes it, and line breaks are preserved. */}
            <p className="whitespace-pre-wrap break-words text-fg">{open.body}</p>
          </article>
        )}
      </Drawer>

      <ComposeDialog
        open={compose !== null}
        initial={compose}
        onClose={() => setCompose(null)}
        onSent={() => { if (box === 'sent') load(1); }}
      />
    </>
  );
}
