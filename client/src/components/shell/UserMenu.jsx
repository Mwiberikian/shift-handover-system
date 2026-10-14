import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import {
  BellRing, CalendarSync, ChevronDown, Download, KeyRound, Mail, Moon,
} from 'lucide-react';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABEL, cx, initials } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import CalendarFeedDialog from './CalendarFeedDialog';
import { promptInstall, useInstallMode } from '../../pwa/install';
import { useThemeSwitch } from '../../lib/preferences';
import {
  currentSubscription, disablePush, enablePush, pushConfig, pushSupported,
} from '../../pwa/push';

const ROW = 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-body text-ink-800 hover:bg-ink-100 hover:text-fg';

// IR-05: the user's own switch for email alerts. In-app notifications are
// always delivered; this only decides whether some of them are also emailed.
function EmailAlertsSwitch() {
  const { profile, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const on = profile?.email_notifications !== false;

  const toggle = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch('/auth/me/preferences', { email_notifications: !on });
      updateProfile(data);
      toast.success(data.email_notifications ? 'Email alerts on' : 'Email alerts off');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SwitchRow icon={Mail} label="Email alerts" detail={on ? 'On: some alerts are also emailed' : 'Off: in-app only'} on={on} onClick={toggle} disabled={busy || !profile} />
  );
}

function SwitchRow({
  icon: Icon, label, detail, on, onClick, disabled,
}) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={disabled} className={cx(ROW, 'justify-between disabled:opacity-60')}>
      <span className="flex items-center gap-2.5">
        <Icon aria-hidden className="size-4 shrink-0 text-ink-500" />
        <span>
          <span className="block">{label}</span>
          <span className="block text-meta text-ink-600">{detail}</span>
        </span>
      </span>
      <span aria-hidden className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', on ? 'bg-brand-red-dark' : 'bg-ink-300')}>
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

// R3: Web Push for this browser or installed app only. Shown when the browser
// supports it and the server has push turned on. The permission prompt comes
// only from clicking the switch.
let pushConfigCache = null;
function PushSwitch() {
  const [state, setState] = useState(null); // null (hidden), 'off', 'on', 'denied'
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState(null);

  useEffect(() => {
    if (!pushSupported()) return undefined;
    let live = true;
    (async () => {
      try {
        pushConfigCache ??= await pushConfig();
        if (!pushConfigCache.enabled || !live) return;
        setPublicKey(pushConfigCache.public_key);
        const sub = await currentSubscription();
        if (!live) return;
        setState(Notification.permission === 'denied' ? 'denied' : sub ? 'on' : 'off');
      } catch {
        // No push on this device.
      }
    })();
    return () => { live = false; };
  }, []);

  if (!state) return null;
  const on = state === 'on';
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setState('off');
        toast.success('Push notifications off on this device');
      } else {
        const result = await enablePush(publicKey);
        setState(result === 'on' ? 'on' : 'denied');
        if (result === 'on') toast.success('Push notifications on for this device');
        else toast.error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
      }
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const detail = { on: 'On: alerts reach this device', off: 'Off: in-app only', denied: 'Blocked in browser settings' }[state];
  return <SwitchRow icon={BellRing} label="Push notifications on this device" detail={detail} on={on} onClick={toggle} disabled={busy} />;
}

// Q3: offered only when the browser says the app can be installed, or on an
// iPhone or iPad (Safari has no install prompt), where it explains how.
function InstallAppItem() {
  const installMode = useInstallMode();
  const [hint, setHint] = useState(false);
  if (!installMode) return null;
  if (installMode === 'prompt') {
    return (
      <button type="button" onClick={promptInstall} className={ROW}>
        <Download aria-hidden className="size-4 text-ink-500" /> Install app
      </button>
    );
  }
  return (
    <>
      <button type="button" aria-expanded={hint} aria-controls="ios-install-hint" onClick={() => setHint((v) => !v)} className={ROW}>
        <Download aria-hidden className="size-4 text-ink-500" /> Install app
      </button>
      {hint && (
        <p id="ios-install-hint" className="px-3 pb-2 text-meta text-ink-600">
          In Safari, tap <span className="font-medium text-fg">Share</span>, then <span className="font-medium text-fg">Add to Home Screen</span>.
        </p>
      )}
    </>
  );
}

// The theme switch as an account row (phones, where the header has no room
// for the sun/moon button).
export function ThemeSwitchRow({ className }) {
  const { theme, toggle } = useThemeSwitch();
  return (
    <button type="button" role="switch" aria-checked={theme === 'dark'} onClick={toggle} className={cx(ROW, className)}>
      <Moon aria-hidden className="size-4 text-ink-500" /> Dark theme
    </button>
  );
}

// Who is signed in: name, role and department, email.
export function AccountSummary() {
  const { claims, profile } = useAuth();
  return (
    <div className="border-b border-ink-100 px-3 pt-2 pb-3">
      <p className="font-medium text-fg">{profile?.full_name ?? '…'}</p>
      <p className="text-meta text-ink-600">{ROLE_LABEL[claims?.role]}{profile?.department_name && ` · ${profile.department_name}`}</p>
      {profile?.email && <p className="truncate text-meta text-ink-600">{profile.email}</p>}
    </div>
  );
}

// The account rows, shared by this menu and the phone's Me sheet. The caller
// owns the calendar dialog, so it outlives the menu that opened it.
export function AccountItems({ onCalendar, children }) {
  return (
    <>
      <EmailAlertsSwitch />
      <PushSwitch />
      <button type="button" onClick={onCalendar} className={ROW}>
        <CalendarSync aria-hidden className="size-4 text-ink-500" /> Calendar subscription
      </button>
      <InstallAppItem />
      {children}
      <Link to="/change-password" className={ROW}>
        <KeyRound aria-hidden className="size-4 text-ink-500" /> Change password
      </Link>
    </>
  );
}

// Account menu in the header: who you are, your email alert switch and a
// password change link. Name and role show beside the avatar from lg up.
export default function UserMenu({ children }) {
  const { claims, profile } = useAuth();
  const [feedOpen, setFeedOpen] = useState(false);
  const name = profile?.full_name ?? '…';
  return (
    <>
    <Popover className="relative">
      <PopoverButton
        aria-label={`Account menu for ${name}`}
        className="flex min-h-11 min-w-11 items-center gap-3 rounded-lg px-1.5 text-left text-white/90 transition-colors hover:bg-white/10 data-open:bg-white/10 lg:px-2"
      >
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-meta font-semibold text-white">
          {initials(name)}
        </span>
        <span className="hidden min-w-0 leading-tight lg:block">
          <span className="block truncate text-sm font-medium text-white">{name}</span>
          <span className="block truncate text-meta text-white/75">
            {ROLE_LABEL[claims?.role]}{profile?.department_name && ` · ${profile.department_name}`}
          </span>
        </span>
        <ChevronDown aria-hidden className="hidden size-4 text-white/60 lg:block" />
      </PopoverButton>
      <PopoverPanel
        transition
        anchor={{ to: 'bottom end', gap: 8, padding: 8 }}
        className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-ink-200 bg-surface p-1.5 shadow-pop transition duration-150 ease-out focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <AccountSummary />
        <div className="pt-1.5">
          <AccountItems onCalendar={() => setFeedOpen(true)}>{children}</AccountItems>
        </div>
      </PopoverPanel>
    </Popover>
    <CalendarFeedDialog open={feedOpen} onClose={() => setFeedOpen(false)} />
    </>
  );
}
