import { useEffect, useRef, useState } from 'react';
import useMediaQuery from './useMediaQuery';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// True when scroll motion may run: the browser has IntersectionObserver and
// the user has not asked for reduced motion. Anything that hides content
// until it animates in must check this first, so content is never left hidden.
export function useMotionOk() {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  return !reduced && typeof window !== 'undefined' && 'IntersectionObserver' in window;
}

// Marks an element revealed once about 15% of it is on screen, then stops
// watching it: each element animates in once, not on every scroll. Without
// motion (see useMotionOk) it reports revealed from the first render.
export default function useReveal({ threshold = 0.15 } = {}) {
  const ref = useRef(null);
  const motionOk = useMotionOk();
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!motionOk || seen || !el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [motionOk, seen, threshold]);

  return [ref, seen || !motionOk, motionOk];
}

// True once the page has scrolled past `offset` pixels.
export function useScrolledPast(offset = 24) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const update = () => setPast(window.scrollY > offset);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [offset]);
  return past;
}

// Moves the element down as the page scrolls, by `rate` of the scroll and at
// most `max` px. Only on md and wider and with motion allowed; the transform
// is written straight to the element, so scrolling does not re-render.
export function useParallax({ rate = 0.25, max = 40 } = {}) {
  const ref = useRef(null);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const wide = useMediaQuery('(min-width: 48rem)');
  const on = wide && !reduced;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!on) {
      el.style.transform = '';
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      el.style.transform = `translate3d(0, ${Math.min(window.scrollY * rate, max).toFixed(1)}px, 0)`;
    };
    const onScroll = () => { frame ||= requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [on, rate, max]);

  return ref;
}
