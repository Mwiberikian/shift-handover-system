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

export const pwaOptions = {
  manifest,
  // The service worker is not registered yet (Q2 adds it).
  injectRegister: false,
  includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
};
