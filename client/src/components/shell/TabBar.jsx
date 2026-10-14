import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { HelpCircle, Home, LogOut, X } from 'lucide-react';
import { cx } from '../../lib/format';
import { useUnreadMessages } from '../../lib/unread';
import { NAV, isTabActive, tabsFor } from './nav';
import { AccountItems, AccountSummary, ThemeSwitchRow } from './UserMenu';
import CalendarFeedDialog from './CalendarFeedDialog';

const ROW = 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-body text-ink-800 hover:bg-ink-100 hover:text-fg';

// Phone account sheet behind the Me tab: the account menu's rows, the screens
// that have no tab of their own, theme and log out.
function MeSheet({
  open, onClose, role, onLogout, onCalendar,
}) {
  const { pathname } = useLocation();
  const tabPaths = new Set(tabsFor(role).map((t) => t.to));
  const more = (NAV[role] ?? []).filter((item) => !tabPaths.has(item.to));
  // Navigating from the sheet closes it.
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50 md:hidden">
      <DialogBackdrop transition className="fixed inset-0 bg-brand-black/40 transition-opacity duration-200 data-closed:opacity-0" />
      <div className="fixed inset-x-0 bottom-0 flex max-h-[85vh]">
        <DialogPanel
          transition
          className="safe-x flex w-full flex-col rounded-t-2xl bg-surface pb-(--safe-bottom) shadow-pop transition duration-200 ease-out data-closed:translate-y-full"
        >
          <div className="flex items-center justify-between px-4 pt-2">
            <DialogTitle className="text-section text-fg">Me</DialogTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-fg">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-1.5 pb-3">
            <AccountSummary />
            {more.length > 0 && (
              <nav aria-label="More" className="border-b border-ink-100 py-1.5">
                {more.map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to} className={ROW}>
                    <Icon aria-hidden className="size-4 text-ink-500" /> {label}
                  </Link>
                ))}
              </nav>
            )}
            <div className="py-1.5">
              <AccountItems onCalendar={() => { onClose(); onCalendar(); }}>
                <ThemeSwitchRow />
              </AccountItems>
              <Link to="/" className={ROW}><Home aria-hidden className="size-4 text-ink-500" /> Home</Link>
              <Link to="/help" className={ROW}><HelpCircle aria-hidden className="size-4 text-ink-500" /> Help</Link>
              <button type="button" onClick={() => { onClose(); onLogout(); }} className={ROW}>
                <LogOut aria-hidden className="size-4 text-ink-500" /> Log out
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

// Bottom tab bar below md (Q4). The same routes, components and copy as the
// sidebar; the sidebar's drawer stays available from the header for the rest.
// While mounted it sets html.with-tabbar, which gives --tabbar-h its height so
// main content, sticky action bars and the offline banner sit above it.
export default function TabBar({ role, onLogout }) {
  const { pathname } = useLocation();
  const unread = useUnreadMessages();
  const [meOpen, setMeOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const tabs = tabsFor(role);

  useEffect(() => {
    document.documentElement.classList.add('with-tabbar');
    return () => document.documentElement.classList.remove('with-tabbar');
  }, []);

  const tabClass = (active) => cx(
    'relative flex h-16 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-meta font-medium transition-colors',
    active ? 'text-accent-fg' : 'text-ink-600 hover:text-fg',
  );
  const indicator = (active) => (
    <span aria-hidden className={cx('absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-red transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
  );

  return (
    <>
      <nav
        aria-label="Tabs"
        className="safe-x fixed inset-x-0 bottom-0 z-40 flex border-t border-ink-200 bg-surface/95 pb-(--safe-bottom) shadow-[0_-4px_12px_rgb(0_0_0/0.05)] backdrop-blur md:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          if (tab.me) {
            return (
              <button key={tab.key} type="button" aria-haspopup="dialog" aria-expanded={meOpen} onClick={() => setMeOpen(true)} className={tabClass(meOpen)}>
                {indicator(meOpen)}
                <Icon aria-hidden className="size-5" />
                {tab.label}
              </button>
            );
          }
          const active = !meOpen && isTabActive(tab, pathname);
          const count = tab.badge === 'messages' ? unread : 0;
          return (
            <Link
              key={tab.key}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              aria-label={count ? `${tab.label}, ${count} unread` : undefined}
              className={tabClass(active)}
            >
              {indicator(active)}
              <span className="relative">
                <Icon aria-hidden className="size-5" />
                {count > 0 && (
                  <span aria-hidden className="absolute -top-1.5 left-3 min-w-4 rounded-full bg-brand-red-dark px-1 text-center text-[0.625rem] leading-4 font-semibold text-white tabular-nums">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <MeSheet open={meOpen} onClose={() => setMeOpen(false)} role={role} onLogout={onLogout} onCalendar={() => setFeedOpen(true)} />
      <CalendarFeedDialog open={feedOpen} onClose={() => setFeedOpen(false)} />
    </>
  );
}
