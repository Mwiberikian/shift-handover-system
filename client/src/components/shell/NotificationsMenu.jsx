import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloseButton, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import {
  Bell, BellOff, BellRing, CheckCheck, Clock, FileText, MessagesSquare,
} from 'lucide-react';
import api from '../../api';
import { ROLE_HOME, useAuth } from '../../auth/AuthContext';
import { cx, fmtRelative } from '../../lib/format';
import { toast } from '../../lib/toast';
import {
  desktopAlertState, disableDesktopAlerts, enableDesktopAlerts, showDesktopAlert,
} from '../../lib/desktopAlerts';

const POLL_MS = 30000;

const NOTIFICATION_LABEL = {
  handover_submitted: 'Handover submitted',
  handover_acknowledged: 'Handover acknowledged',
  handover_queried: 'Query raised on your handover',
  handover_clarified: 'Clarification received',
  handover_escalated: 'Handover escalated',
  handover_closed: 'Handover closed',
};

const KIND = {
  reminder: { icon: Clock, chip: 'bg-status-amber-soft text-status-amber ring-status-amber-line' },
  message: { icon: MessagesSquare, chip: 'bg-status-blue-soft text-status-blue ring-status-blue-line' },
  handover: { icon: FileText, chip: 'bg-ink-100 text-ink-700 ring-ink-200' },
};

// Title, detail line and kind for one notification.
function describe(n) {
  if (n.type === 'reminder') return { kind: 'reminder', title: n.title ?? 'Reminder', detail: n.body ?? '' };
  if (n.type === 'message') {
    return { kind: 'message', title: `Message from ${n.message_sender_name ?? 'a colleague'}`, detail: n.message_subject || 'Open Messages to read it.' };
  }
  return {
    kind: 'handover',
    title: NOTIFICATION_LABEL[n.type] || n.type,
    detail: `${n.department_code} · record ${n.record_id?.slice(0, 8)} · now ${n.record_status?.replace('_', ' ')}`,
  };
}

// Where clicking a notification takes you.
function targetFor(n, role) {
  if (n.type === 'message') return '/messages';
  if (n.type !== 'reminder') return null;
  if (n.reminder_type?.startsWith('handover_due')) return '/outgoing';
  if (n.reminder_type === 'ack_pending') return '/incoming';
  if (n.reminder_type?.startsWith('supervisor_')) return '/supervisor';
  return ROLE_HOME[role];
}

function DesktopAlertsToggle() {
  const [state, setState] = useState(desktopAlertState);
  if (state === 'unsupported') return null;
  if (state === 'blocked') {
    return <p className="flex items-center gap-1.5 text-meta text-ink-600"><BellOff aria-hidden className="size-3.5" />Desktop alerts are blocked in your browser settings.</p>;
  }
  return state === 'on' ? (
    <button type="button" onClick={() => setState(disableDesktopAlerts())} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium text-status-green hover:bg-ink-100">
      <BellRing aria-hidden className="size-3.5" /> Desktop alerts on · turn off
    </button>
  ) : (
    <button
      type="button"
      onClick={async () => {
        const next = await enableDesktopAlerts();
        setState(next);
        if (next === 'on') toast.success('Desktop alerts enabled', { description: 'Reminders will also appear as browser notifications.' });
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium text-ink-700 hover:bg-ink-100 hover:text-fg"
    >
      <BellRing aria-hidden className="size-3.5" /> Enable desktop alerts
    </button>
  );
}

export default function NotificationsMenu() {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();
  const { claims } = useAuth();
  const seen = useRef(null); // ids already shown; null until the first load

  const load = useCallback(async () => {
    let list;
    try {
      list = (await api.get('/notifications')).data;
    } catch {
      return;
    }
    // Announce reminders that arrived since the previous poll (not on first load).
    if (seen.current) {
      for (const n of list) {
        if (n.type === 'reminder' && !n.read_at && !seen.current.has(n.notification_id)) {
          toast(n.title ?? 'Reminder', { description: n.body, icon: <Clock aria-hidden className="size-4 text-status-amber" />, duration: 10000 });
          showDesktopAlert(n.title ?? 'Shift Handover reminder', n.body ?? '', n.notification_id);
        }
      }
    }
    seen.current = new Set(list.map((n) => n.notification_id));
    setItems(list);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const unread = items.filter((n) => !n.read_at);
  const markRead = async (n) => {
    if (!n.read_at) await api.post(`/notifications/${n.notification_id}/read`).catch(() => {});
    load();
  };
  const markAllRead = async () => {
    await Promise.all(unread.map((n) => api.post(`/notifications/${n.notification_id}/read`).catch(() => {})));
    load();
  };

  return (
    <Popover className="relative">
      <PopoverButton
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        className="relative grid size-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white data-open:bg-white/10 data-open:text-white"
      >
        <Bell aria-hidden className="size-5" />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-red-dark px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-brand-black">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </PopoverButton>

      <PopoverPanel
        transition
        anchor={{ to: 'bottom end', gap: 8, padding: 8 }}
        className="z-50 flex w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-pop transition duration-150 ease-out data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <h2 className="m-0 text-section">Notifications</h2>
          {unread.length > 0 && (
            <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-ink-600 hover:bg-ink-100 hover:text-fg">
              <CheckCheck aria-hidden className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-ink-600">
            <Bell aria-hidden className="size-6 text-ink-400" />
            <p>You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => {
              const d = describe(n);
              const { icon: Icon, chip } = KIND[d.kind];
              const to = targetFor(n, claims?.role);
              return (
                <li key={n.notification_id} className={cx('border-b border-ink-100 last:border-0', d.kind === 'reminder' && !n.read_at && 'border-l-2 border-l-status-amber')}>
                  <CloseButton
                    as="button"
                    type="button"
                    onClick={() => { markRead(n); if (to) navigate(to); }}
                    className={cx('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 focus-visible:bg-ink-50', !n.read_at && 'bg-ink-50/60')}
                  >
                    <span aria-hidden className={cx('relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset', chip)}>
                      <Icon className="size-4" />
                      {!n.read_at && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand-red ring-2 ring-surface" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block', n.read_at ? 'font-medium text-ink-700' : 'font-semibold text-fg')}>
                        {d.kind === 'reminder' && <span className="sr-only">Reminder: </span>}
                        {d.title}
                        {!n.read_at && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className={cx('block text-meta text-ink-600', d.kind === 'reminder' ? 'line-clamp-2' : 'truncate')}>{d.detail}</span>
                      <span className="mt-0.5 block text-meta text-ink-600">{fmtRelative(n.sent_at)}</span>
                    </span>
                  </CloseButton>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-ink-200 bg-ink-50/60 px-3 py-2">
          <DesktopAlertsToggle />
        </div>
      </PopoverPanel>
    </Popover>
  );
}
