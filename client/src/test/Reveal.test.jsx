import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Reveal from '../components/ui/Reveal';
import AuthShell from '../components/shell/AuthShell';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';

// A stand-in IntersectionObserver whose callback the test fires by hand.
let observers = [];
class FakeIO {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }
  observe(el) { this.targets.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  enter() { this.callback(this.targets.map((target) => ({ target, isIntersecting: true }))); }
}

const originalMatchMedia = window.matchMedia;
function prefersReducedMotion() {
  window.matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}

beforeEach(() => {
  observers = [];
  window.IntersectionObserver = FakeIO;
});
afterEach(() => {
  delete window.IntersectionObserver;
  window.matchMedia = originalMatchMedia;
});

describe('Reveal', () => {
  test('renders its children, hidden until about 15% is in view, then revealed once', () => {
    render(<Reveal as="section" delay={200} data-testid="box"><p>Handover record</p></Reveal>);
    const box = screen.getByTestId('box');
    expect(box.tagName).toBe('SECTION');
    expect(screen.getByText('Handover record')).toBeInTheDocument();
    expect(box).toHaveClass('opacity-0', 'translate-y-5');
    expect(box.style.transitionDelay).toBe('200ms');
    expect(observers).toHaveLength(1);
    expect(observers[0].options.threshold).toBe(0.15);

    act(() => observers[0].enter());
    expect(box).toHaveClass('opacity-100', 'translate-0');
    expect(box).not.toHaveClass('opacity-0');
    expect(box).toHaveAttribute('data-revealed');
    // Animates once: it stops watching after the first reveal.
    expect(observers[0].disconnected).toBe(true);
    expect(observers).toHaveLength(1);
  });

  test.each([['left', '-translate-x-5'], ['right', 'translate-x-5']])('direction %s starts offset sideways', (direction, cls) => {
    render(<Reveal direction={direction} data-testid="box">Card</Reveal>);
    expect(screen.getByTestId('box')).toHaveClass('opacity-0', cls);
  });

  test('direction fade starts with no offset', () => {
    render(<Reveal direction="fade" data-testid="box">Card</Reveal>);
    const box = screen.getByTestId('box');
    expect(box).toHaveClass('opacity-0');
    expect(box.className).not.toMatch(/translate-[xy]/);
  });

  test('with prefers-reduced-motion it shows the children at once, with no transform or transition', () => {
    prefersReducedMotion();
    render(<Reveal delay={300} className="extra" data-testid="box"><p>Handover record</p></Reveal>);
    const box = screen.getByTestId('box');
    expect(screen.getByText('Handover record')).toBeVisible();
    expect(box.className).toBe('extra');
    expect(box.style.transitionDelay).toBe('');
    expect(observers).toHaveLength(0);
  });

  test('without IntersectionObserver it does not hide anything', () => {
    delete window.IntersectionObserver;
    render(<Reveal className="extra" data-testid="box"><p>Handover record</p></Reveal>);
    const box = screen.getByTestId('box');
    expect(screen.getByText('Handover record')).toBeVisible();
    expect(box.className).toBe('extra');
  });
});

describe('AuthShell photo', () => {
  const renderShell = (props) => render(
    <ThemeProvider><MemoryRouter><AuthShell {...props}><p>Form</p></AuthShell></MemoryRouter></ThemeProvider>,
  );

  test('login photo: decorative <picture>, WebP and JPG at 800 and 1600, eager, credits link', () => {
    const { container } = renderShell({ photo: 'login' });
    const img = container.querySelector('picture img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('width', '1600');
    expect(img).toHaveAttribute('height', '2400');
    expect(img.getAttribute('srcset')).toBe('/images/login-800.jpg 800w, /images/login-1600.jpg 1600w');
    expect(img.style.objectPosition).toBe('40% 60%');
    const [phone, webp] = container.querySelectorAll('picture source');
    // Below lg the panel is hidden, so phones get a 1 px placeholder instead.
    expect(phone.getAttribute('srcset')).toMatch(/^data:image\/gif/);
    expect(webp).toHaveAttribute('type', 'image/webp');
    expect(webp.getAttribute('srcset')).toBe('/images/login-800.webp 800w, /images/login-1600.webp 1600w');
    expect(screen.getByRole('link', { name: 'Photo credits' })).toHaveAttribute('href', '/images/CREDITS.txt');
  });

  test('sign-up photo keeps the hands and laptop in view', () => {
    const { container } = renderShell({ photo: 'signup' });
    expect(container.querySelector('picture img').style.objectPosition).toBe('70% 55%');
  });

  test('no photo: the drawn art and no credits link', () => {
    const { container } = renderShell({});
    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('svg[viewBox="0 0 480 340"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Photo credits' })).toBeNull();
  });
});
