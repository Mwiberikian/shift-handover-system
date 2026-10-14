import { WifiOff } from 'lucide-react';
import useOnline from '../../lib/useOnline';

export const OFFLINE_MESSAGE = 'You are offline. Changes cannot be saved.';

// Shown on every screen while the browser reports no connection. The app keeps
// no data offline (Section 1.5.1), so nothing typed can be saved until the
// connection returns. Sits above the bottom tab bar and the home indicator.
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(var(--tabbar-h,0px)+var(--safe-bottom))] z-[55] flex justify-center px-4 pb-3 pointer-events-none"
    >
      <p className="safe-x pointer-events-auto flex min-h-11 items-center gap-2 rounded-lg border border-status-amber-line bg-status-amber-soft px-4 py-2 text-body font-medium text-status-amber shadow-pop">
        <WifiOff aria-hidden className="size-4 shrink-0" />
        {OFFLINE_MESSAGE}
      </p>
    </div>
  );
}
