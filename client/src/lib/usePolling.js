import { useEffect, useRef } from 'react';
import { useRefresh } from './refresh';

// Interval the bell and message badge poll at. NFR-03: notifications appear
// within 5 seconds.
export const POLL_MS = 5000;

// Calls `fn` now and every `ms` while the tab is visible. Polling stops while
// the tab is hidden and resumes, with an immediate call, when it is shown.
// `fn` may change between renders without restarting the timer. It also runs
// when the user returns (window focus, connection back: lib/refresh.js),
// unless it ran in the last second.
export default function usePolling(fn, ms = POLL_MS, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  const lastRun = useRef(0);
  useRefresh((reason) => {
    if (reason === 'return' && !document.hidden && Date.now() - lastRun.current >= 1000) {
      lastRun.current = Date.now();
      latest.current();
    }
  }, enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => {
      lastRun.current = Date.now();
      latest.current();
    };
    const start = () => {
      if (timer === null) {
        tick();
        timer = setInterval(tick, ms);
      }
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}
