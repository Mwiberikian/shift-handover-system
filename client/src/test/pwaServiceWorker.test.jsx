// Q2: the service worker caches the app shell only, API calls are
// NetworkOnly, and the offline banner and update prompt.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { isNetworkOnly, workbox } from '../../pwa.config.js';
import OfflineBanner from '../components/shell/OfflineBanner';
import UpdatePrompt from '../components/shell/UpdatePrompt';
import { setNeedRefresh } from '../pwa/registerSW';

const req = (url, headers = {}) => ({ url: new URL(url), request: new Request(url, { headers }) });

describe('service worker caching rules', () => {
  test('API requests on any origin are NetworkOnly', () => {
    expect(isNetworkOnly(req('https://api.shms.example/api/handovers'))).toBe(true);
    expect(isNetworkOnly(req('http://localhost:4000/api/notifications/unread-count'))).toBe(true);
  });

  test('any request with Authorization is NetworkOnly', () => {
    expect(isNetworkOnly(req('https://shms.example/anything', { Authorization: 'Bearer x' }))).toBe(true);
  });

  test('shell files are not', () => {
    expect(isNetworkOnly(req('https://shms.example/assets/index-abc.js'))).toBe(false);
    expect(isNetworkOnly(req('https://shms.example/supervisor/queue'))).toBe(false);
  });

  test('the only runtime route is NetworkOnly: nothing is cached at runtime', () => {
    expect(workbox.runtimeCaching.length).toBeGreaterThan(0);
    for (const route of workbox.runtimeCaching) {
      expect(route.handler).toBe('NetworkOnly');
      expect(route.urlPattern).toBe(isNetworkOnly);
    }
  });

  test('isNetworkOnly works once serialised into sw.js (no outside references)', () => {
    // eslint-disable-next-line no-new-func
    const copy = new Function(`return (${isNetworkOnly.toString()})`)();
    expect(copy(req('https://api.shms.example/api/x'))).toBe(true);
    expect(copy(req('https://shms.example/index.html'))).toBe(false);
  });

  test('precache is the app shell: no photos, no data', () => {
    expect(workbox.globPatterns.join(' ')).not.toMatch(/webp|jpe?g|json/);
    expect(workbox.globIgnores).toContain('**/*.webp');
    expect(workbox.navigateFallback).toBe('/index.html');
    expect(workbox.navigateFallbackDenylist.some((re) => re.test('/api/handovers'))).toBe(true);
  });

  test('a new version waits for the user', () => {
    expect(workbox.skipWaiting).toBe(false);
  });
});

describe('OfflineBanner', () => {
  const setOnline = (value) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
    act(() => { window.dispatchEvent(new Event(value ? 'online' : 'offline')); });
  };
  afterEach(() => setOnline(true));

  test('appears when the connection drops and goes when it returns', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    setOnline(false);
    expect(screen.getByRole('status')).toHaveTextContent('You are offline. Changes cannot be saved.');
    setOnline(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('UpdatePrompt', () => {
  afterEach(() => act(() => setNeedRefresh(false)));

  test('hidden until a new version is waiting; Later dismisses it', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => setNeedRefresh(true));
    expect(screen.getByRole('alertdialog', { name: 'Update available' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('Reload switches to the new version', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      render(<UpdatePrompt />);
      act(() => setNeedRefresh(true));
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
