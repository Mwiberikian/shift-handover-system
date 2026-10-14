import { useSyncExternalStore } from 'react';

// navigator.onLine, kept current by the browser's online/offline events.
function subscribe(fn) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

export default function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
