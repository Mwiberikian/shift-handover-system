import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL, initials } from '../lib/format';
import { NAV } from './shell/nav';
import SidebarNav from './shell/Sidebar';
import NotificationsMenu from './shell/NotificationsMenu';

function Wordmark() {
  return (
    <span className="flex items-baseline gap-2 select-none">
      <span className="text-xl font-extrabold tracking-tight text-brand-red">SHMS</span>
      <span className="hidden text-sm font-medium text-zinc-300 sm:inline">Shift Handover</span>
    </span>
  );
}

function UserBlock({ profile, role, dark = true }) {
  const name = profile?.full_name ?? '…';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full text-meta font-semibold ${dark ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
        {initials(name)}
      </span>
      <span className="min-w-0 leading-tight">
        <span className={`block truncate text-sm font-medium ${dark ? 'text-white' : 'text-brand-black'}`}>{name}</span>
        <span className={`block truncate text-meta ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>
          {ROLE_LABEL[role]}{profile?.department_name && ` · ${profile.department_name}`}
        </span>
      </span>
    </div>
  );
}

export default function Layout() {
  const { claims, profile, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  if (!claims) return <Navigate to="/login" replace />;
  const items = NAV[claims.role] ?? [];

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-[60] rounded-md bg-white px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b-2 border-brand-red bg-brand-black px-3 sm:px-4">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white md:hidden"
        >
          <Menu aria-hidden className="size-5" />
        </button>
        <Wordmark />

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <NotificationsMenu />
          <span aria-hidden className="hidden h-6 w-px bg-white/15 md:block" />
          <div className="hidden md:block"><UserBlock profile={profile} role={claims.role} /></div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut aria-hidden className="size-[18px]" />
            <span className="hidden sm:inline">Log out</span>
            <span className="sr-only sm:hidden">Log out</span>
          </button>
        </div>
      </header>

      {/* Rail on tablets, full sidebar from lg up, drawer below md. */}
      <aside className="fixed top-14 bottom-0 left-0 z-30 hidden w-16 border-r border-zinc-200 bg-white md:block lg:w-60">
        <div className="lg:hidden"><SidebarNav items={items} compact /></div>
        <div className="hidden lg:block"><SidebarNav items={items} /></div>
      </aside>

      <Dialog open={drawerOpen} onClose={setDrawerOpen} className="relative z-50 md:hidden">
        <DialogBackdrop transition className="fixed inset-0 bg-brand-black/40 transition-opacity duration-200 data-closed:opacity-0" />
        <DialogPanel
          transition
          className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-pop transition duration-200 ease-out data-closed:-translate-x-full"
        >
          <div className="flex h-14 items-center justify-between border-b-2 border-brand-red bg-brand-black px-4">
            <Wordmark />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="grid size-9 place-items-center rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav items={items} onNavigate={() => setDrawerOpen(false)} />
          </div>
          <div className="border-t border-zinc-200 p-4">
            <UserBlock profile={profile} role={claims.role} dark={false} />
          </div>
        </DialogPanel>
      </Dialog>

      <main id="main" className="pt-14 md:pl-16 lg:pl-60">
        {/* Keyed on the route so each screen fades in on navigation. */}
        <div key={pathname} className="mx-auto max-w-screen-2xl animate-page-in px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
