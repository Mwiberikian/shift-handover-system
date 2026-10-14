import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cx } from '../../lib/format';
import { freshness, requestRefresh, useLastSynced } from '../../lib/refresh';
import useOnline from '../../lib/useOnline';

// R2: a quiet "Updated just now" in the utility bar, amber once the data is
// stale (no answer from the server for 30 s, or offline). Tapping it refetches.
export default function SyncStatus() {
  const syncedAt = useLastSynced();
  const online = useOnline();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const { label, stale } = freshness(syncedAt, Math.max(now, syncedAt ?? 0), online);
  return (
    <button
      type="button"
      onClick={() => requestRefresh('manual')}
      aria-label={`${label}. Refresh now`}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded px-1.5 transition-colors',
        stale ? 'text-status-amber-line hover:text-white' : 'text-white/60 hover:text-white',
      )}
    >
      <RefreshCw aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
