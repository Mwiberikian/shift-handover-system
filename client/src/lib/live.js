import { useEffect, useState } from 'react';

// Client-side ticking of server-measured times (Part M4/M5).
//
// The server sends server_now with every answer. offset = server_now - the
// browser's clock when the answer arrived, so a timer that started at
// started_at (server time) has run for  browserNow + offset - started_at,
// whatever the browser clock says.

export const clockOffset = (serverNow, receivedAt = Date.now()) => new Date(serverNow).getTime() - receivedAt;

export function elapsedSince(startedAt, offsetMs, nowMs = Date.now()) {
  if (!startedAt) return 0;
  return Math.max(0, nowMs + offsetMs - new Date(startedAt).getTime());
}

// 0:07, 12:05, 1:02:03 (h:mm:ss once an hour has passed)
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// The browser's clock, updated every second while the tab is visible (a
// hidden tab does not tick; it catches up when shown).
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const start = () => {
      setNow(Date.now());
      if (timer === null) timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
  return now;
}
