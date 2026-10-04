import { useCallback, useEffect, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Bell, CheckCheck } from 'lucide-react';
import api from '../../api';
import { cx, fmtRelative } from '../../lib/format';

const NOTIFICATION_LABEL = {
  handover_submitted: 'Handover submitted',
  handover_acknowledged: 'Handover acknowledged',
  handover_queried: 'Query raised on your handover',
  handover_clarified: 'Clarification received',
  handover_escalated: 'Handover escalated',
  handover_closed: 'Handover closed',
};

export default function NotificationsMenu() {
  const [items, setItems] = useState([]);

  const load = useCallback(() => api.get('/notifications').then((r) => setItems(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
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
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-ink-500">
            <Bell aria-hidden className="size-6 text-ink-300" />
            <p>You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.notification_id} className="border-b border-ink-100 last:border-0">
                <button
                  type="button"
                  onClick={() => markRead(n)}
                  className={cx('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 focus-visible:bg-ink-50', n.read_at && 'opacity-60')}
                >
                  <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-red')} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-fg">
                      {NOTIFICATION_LABEL[n.type] || n.type}
                      {!n.read_at && <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="block truncate text-meta text-ink-600">
                      {n.department_code} · record {n.record_id?.slice(0, 8)} · now {n.record_status?.replace('_', ' ')}
                    </span>
                    <span className="mt-0.5 block text-meta text-ink-500">{fmtRelative(n.sent_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverPanel>
    </Popover>
  );
}
