import { useEffect, useState } from 'react';
import api from '../api';

// Phase 3: whether the server derives duty from the roster
// (ROSTER_DUTY_ENABLED), shared across the app for one page load.
//
// Nothing here makes a request on its own. The answer arrives in one of two
// ways:
//   1. the "Who is on shift" card's existing request answers with
//      `roster_duty: true` when the flag is on (setRosterDuty);
//   2. a staff member lands on the OTHER staff area: the route guard then
//      asks GET /shifts/duty/config (fetchRosterDuty). A failure or a slow
//      answer counts as OFF, so they are sent home exactly as before.
// So with the flag off, nobody else ever makes an extra request.
let cached = null; // null = unknown, true/false = known
let inflight = null;
let timeoutMs = 3000;
const listeners = new Set();

export function setRosterDuty(value) {
  if (cached === value) return;
  cached = value;
  listeners.forEach((fn) => fn(value));
}

export function fetchRosterDuty() {
  if (cached !== null) return Promise.resolve(cached);
  inflight ??= Promise.race([
    api.get('/shifts/duty/config').then((r) => r?.data?.enabled === true).catch(() => false),
    new Promise((resolve) => { setTimeout(() => resolve(false), timeoutMs); }),
  ]).then((value) => {
    inflight = null;
    if (cached === null) setRosterDuty(value);
    return cached;
  });
  return inflight;
}

function useCached() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    listeners.add(setValue);
    setValue(cached);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

// Passive: true only once something has told us the flag is on. Never fetches.
export default function useRosterDuty() {
  return { enabled: useCached() === true };
}

// For the route guard: when `needed` and the answer is unknown, ask the
// server (once per page load). Returns { enabled, loading }.
export function useRosterDutyCheck(needed) {
  const value = useCached();
  useEffect(() => {
    if (needed && value === null) fetchRosterDuty();
  }, [needed, value]);
  return { enabled: value === true, loading: needed && value === null };
}

// Tests only.
export function resetRosterDutyCache({ timeout = 3000 } = {}) {
  cached = null;
  inflight = null;
  timeoutMs = timeout;
}
