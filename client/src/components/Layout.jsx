import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL, initials } from '../lib/format';
import { NAV } from './shell/nav';
import SidebarNav from './shell/Sidebar';
import NotificationsMenu from './shell/NotificationsMenu';
import ThemeToggle from './shell/ThemeToggle';
import HelpMenu from './shell/HelpMenu';
import UtilityBar from './shell/UtilityBar';
import { pagePhotoFor } from './shell/pagePhotos';
import { useUnreadPolling } from '../lib/unread';
import { cx } from '../lib/format';
import { ConfirmDialog } from './ui';
import Brand from './shell/Brand';

function UserBlock({ profile, role, dark = true }) {
  const name = profile?.full_name ?? '…';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full text-meta font-semibold ${dark ? 'bg-white/10 text-white' : 'bg-ink-100 text-ink-700'}`}>
        {initials(name)}
      </span>
      <span className="min-w-0 leading-tight">
        <span className={`block truncate text-sm font-medium ${dark ? 'text-white' : 'text-fg'}`}>{name}</span>
        <span className={`block truncate text-meta ${dark ? 'text-white/75' : 'text-ink-600'}`}>
          {ROLE_LABEL[role]}{profile?.department_name && ` · ${profile.department_name}`}
        </span>
      </span>
    </div>
  );
}

export default function Layout() {
  const { claims, profile, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const { pathname } = useLocation();
  useUnreadPolling(claims?.user_id);
  if (!claims) return <Navigate to="/login" replace />;
  const items = NAV[claims.role] ?? [];
  const photo = pagePhotoFor(claims.role, pathname);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-[60] rounded-md bg-surface px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      {/* Fixed chrome: utility bar (2rem) + header (3.5rem) = top-22 offsets below. */}
      <div className="fixed inset-x-0 top-0 z-40">
        <UtilityBar />
        <header className="glass-dark flex h-14 items-center gap-2 border-b-2 border-brand-red px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white md:hidden"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <Brand showName={false} className="sm:hidden" />
          <Brand className="hidden sm:flex" />
  
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <ThemeToggle />
            <div className="hidden sm:block"><HelpMenu /></div>
            <NotificationsMenu />
            <span aria-hidden className="hidden h-6 w-px bg-white/15 md:block" />
            <div className="hidden md:block"><UserBlock profile={profile} role={claims.role} /></div>
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut aria-hidden className="size-[18px]" />
              <span className="hidden sm:inline">Log out</span>
              <span className="sr-only sm:hidden">Log out</span>
            </button>
          </div>
        </header>
      </div>

      {/* Rail on tablets, full sidebar from lg up, drawer below md. */}
      <aside className="fixed top-22 bottom-0 left-0 z-30 hidden w-16 border-r border-ink-200 bg-surface md:block lg:w-60">
        <div className="lg:hidden"><SidebarNav items={items} compact /></div>
        <div className="hidden lg:block"><SidebarNav items={items} /></div>
      </aside>

      <Dialog open={drawerOpen} onClose={setDrawerOpen} className="relative z-50 md:hidden">
        <DialogBackdrop transition className="fixed inset-0 bg-brand-black/40 transition-opacity duration-200 data-closed:opacity-0" />
        <DialogPanel
          transition
          className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop transition duration-200 ease-out data-closed:-translate-x-full"
        >
          <div className="flex h-14 items-center justify-between border-b-2 border-brand-red bg-brand-black px-4">
            <Brand showName={false} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav items={items} onNavigate={() => setDrawerOpen(false)} />
          </div>
          <div className="border-t border-ink-200 p-4">
            <UserBlock profile={profile} role={claims.role} dark={false} />
          </div>
        </DialogPanel>
      </Dialog>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        icon={LogOut}
        title="Log out?"
        confirmLabel="Log out"
        message={<p>Are you sure you want to log out? Any unsaved changes on this page will be lost.</p>}
      />

      <main
        id="main"
        className={cx('min-h-screen pt-22 md:pl-16 lg:pl-60', photo && 'page-photo')}
        style={photo ? { '--page-photo': `url(${photo})` } : undefined}
      >
        {/* Keyed on the route so each screen fades in on navigation. */}
        <div key={pathname} className="mx-auto max-w-screen-2xl animate-page-in px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
