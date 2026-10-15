import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import api from '../api';
import { toast, toastError } from './toast';
import usePolling from './usePolling';
import { clockOffset } from './live';

// The worker's own work session and task timer (Part M5), shared by the
// header clock, the task timers and the My work page.
//
// While a session runs, a heartbeat goes to the server every 60 s while the
// tab is visible (usePolling pauses when it is hidden). Without heartbeats
// the server ends the session after 10 minutes, at the last heartbeat.

export const HEARTBEAT_MS = 60 * 1000;
export const WORKER_ROLES = ['outgoing_staff', 'incoming_staff'];

export const SESSION_NOTICE = 'Your session and task times are visible to your supervisor. Nothing else on your device is tracked.';
const NOTICE_KEY = 'shms.sessionNoticeSeen';

export function noticeSeen() {
  try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; }
}
export function markNoticeSeen() {
  try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* private mode: shown again next time */ }
}

// Outside the provider (or for supervisors and admins): nothing to show.
const WorkSessionContext = createContext({
  enabled: false, loaded: false, session: null, timer: null, offset: 0, history: null, refresh: () => {},
});

export function WorkSessionProvider({ enabled, children }) {
  const [state, setState] = useState({ session: null, timer: null, offset: 0, loaded: false });
  const [history, setHistory] = useState(null);

  const apply = useCallback((data) => {
    setState({
      session: data.session, timer: data.timer, offset: clockOffset(data.server_now), loaded: true,
    });
    if (data.history) setHistory(data.history);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      apply((await api.get('/sessions/mine')).data);
    } catch {
      setState((s) => ({ ...s, loaded: true }));
    }
  }, [enabled, apply]);

  // Load once, then refresh when the user comes back to the tab.
  usePolling(refresh, 5 * 60 * 1000, enabled);

  const active = Boolean(state.session);
  usePolling(useCallback(async () => {
    if (!active) return;
    try {
      apply((await api.post('/sessions/heartbeat')).data);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.info(err.response.data.error);
        refresh();
      }
    }
  }, [active, apply, refresh]), HEARTBEAT_MS, enabled && active);

  const run = useCallback(async (fn) => {
    try {
      apply((await fn()).data);
      return true;
    } catch (err) {
      toastError(err);
      refresh();
      return false;
    }
  }, [apply, refresh]);

  const value = useMemo(() => ({
    enabled,
    ...state,
    history,
    refresh,
    start: () => run(() => api.post('/sessions/start')),
    end: async () => {
      const ok = await run(() => api.post('/sessions/end'));
      if (ok) refresh();
      return ok;
    },
    startTimer: (taskId) => run(() => api.post(`/tasks/${taskId}/timer/start`)),
    stopTimer: (taskId) => run(() => api.post(`/tasks/${taskId}/timer/stop`)),
  }), [enabled, state, history, refresh, run]);

  return <WorkSessionContext.Provider value={value}>{children}</WorkSessionContext.Provider>;
}

export const useWorkSession = () => useContext(WorkSessionContext);
