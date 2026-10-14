import { RefreshCw } from 'lucide-react';
import { applyUpdate, setNeedRefresh, useUpdateAvailable } from '../../pwa/registerSW';
import { Button } from '../ui';

// Offered when a new build has been downloaded. Reload switches to it; Later
// keeps the current page (the new version starts with the next visit).
export default function UpdatePrompt() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby="update-title"
      aria-describedby="update-text"
      className="fixed right-4 bottom-[calc(var(--tabbar-h,0px)+var(--safe-bottom)+1rem)] left-4 z-[56] mx-auto max-w-sm rounded-xl border border-ink-200 bg-surface p-4 shadow-pop sm:left-auto"
    >
      <p id="update-title" className="flex items-center gap-2 font-semibold text-fg">
        <RefreshCw aria-hidden className="size-4 text-ink-500" /> Update available
      </p>
      <p id="update-text" className="mt-1 text-ink-600">A new version of SHMS is ready. Save your work, then reload.</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setNeedRefresh(false)}>Later</Button>
        <Button variant="primary" onClick={applyUpdate}>Reload</Button>
      </div>
    </div>
  );
}
