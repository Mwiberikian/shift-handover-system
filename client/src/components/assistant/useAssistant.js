import { useCallback, useEffect, useState } from 'react';
import api from '../../api';

// True when the server has the assistant switched on (ASSISTANT_ENABLED).
// Any failure counts as off: the assistant is advisory, never required.
export function useAssistantEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await api.get('/assistant/config');
        if (live) setEnabled(res?.data?.enabled === true);
      } catch {
        if (live) setEnabled(false);
      }
    })();
    return () => { live = false; };
  }, []);
  return enabled;
}

// Records what the user did with a suggestion. Best effort and silent.
export function logAssistantEvent(kind, record_id, payload) {
  Promise.resolve()
    .then(() => api.post('/assistant/events', { kind, record_id: record_id || undefined, payload }))
    .catch(() => {});
}

// Loads one assistant endpoint; `deps` re-fetch it. Returns { data, error, loading }.
export function useAssistantData(url, deps = [], { enabled = true, params } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const key = JSON.stringify([url, params, ...deps]);
  const load = useCallback(async () => {
    try {
      const res = await api.get(url, { params });
      setState({ data: res?.data ?? null, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return state;
}
