import { useSyncExternalStore } from 'react';

// True while the media query matches; follows resizes and rotation.
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Below Tailwind's md breakpoint (48rem): phones, where the tab bar shows.
export const PHONE_QUERY = '(max-width: 47.98rem)';
