import { useEffect, useSyncExternalStore } from 'react';
import api from '../api';

// Unread message count shared by the sidebar badge and the Messages page.
// Polled every 30 seconds (no websockets); refreshUnread() forces an update,
// e.g. right after a message is opened.
let count = 0;
const subscribers = new Set();
const emit = () => subscribers.forEach((fn) => fn());

export async function refreshUnread() {
  try {
    const { data } = await api.get('/messages/unread-count');
    if (data.count !== count) {
      count = data.count;
      emit();
    }
  } catch {
    // Keep the last known count; the next poll retries.
  }
}

export function useUnreadMessages() {
  return useSyncExternalStore(
    (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    () => count,
  );
}

// Mounted once by the app layout while signed in.
export function useUnreadPolling(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    count = 0;
    emit();
    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    return () => clearInterval(t);
  }, [userId]);
}
