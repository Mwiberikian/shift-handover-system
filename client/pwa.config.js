// Installable app (Parts Q1, Q2): the web app manifest and the service worker
// settings for vite-plugin-pwa. Colours are the design tokens in
// src/index.css: the header is brand-black in both themes, the light page
// canvas is ink-50.
export const THEME_COLOR = '#0d0d0d'; // --color-brand-black
export const BACKGROUND_COLOR = '#fafafa'; // --color-ink-50 (light)

export const manifest = {
  id: '/',
  name: 'SHMS – Shift Handover Management',
  short_name: 'SHMS',
  description: 'Digital shift handovers with acknowledgement, supervisor review and an audit trail.',
  lang: 'en',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  categories: ['business', 'productivity'],
  icons: [
    { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// True for every request the service worker must leave to the network: API
// calls (any origin: in production the API is usually on its own host) and
// anything carrying an Authorization header. Workbox serialises this function
// into sw.js, so it must not use anything outside its own body.
export function isNetworkOnly({ url, request }) {
  return url.pathname.startsWith('/api/') || request.headers.has('authorization');
}

export const workbox = {
  // App shell only: the HTML, the JS and CSS chunks, the font and the icons.
  // Not the page photos, and never data. Section 1.5.1: no offline data.
  globPatterns: ['**/*.{html,js,css,woff2}', 'icons/*.{png,svg}', 'manifest.webmanifest'],
  globIgnores: ['**/assets/images/**', '**/*.webp'],
  // Deep links (/supervisor/queue) open the shell; the API is never a page.
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/api\//],
  cleanupOutdatedCaches: true,
  // Push and notification-click handlers (R3), kept in public/push-sw.js.
  importScripts: ['push-sw.js'],
  // The new version waits until the user chooses Reload in the prompt.
  skipWaiting: false,
  clientsClaim: false,
  runtimeCaching: [
    // NetworkOnly: never stored in any cache, so a response to a request with
    // Authorization cannot be cached either. Offline, the call fails and the
    // offline banner explains why. Other methods are not routed at all: the
    // service worker passes them straight to the network, and the Cache API
    // cannot store them.
    { urlPattern: isNetworkOnly, handler: 'NetworkOnly', method: 'GET' },
  ],
};

export const pwaOptions = {
  manifest,
  // Registered from src/pwa/registerSW.js, which drives the update prompt.
  registerType: 'prompt',
  injectRegister: false,
  workbox,
};
