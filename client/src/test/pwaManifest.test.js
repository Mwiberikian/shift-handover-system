// Q1: the installable-app manifest, icons and head tags.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { manifest, THEME_COLOR, BACKGROUND_COLOR } from '../../pwa.config.js';

// Vitest runs from the client directory.
const root = `${resolve(process.cwd())}/`;
const read = (p) => readFileSync(`${root}${p}`);
const html = read('index.html').toString();
const css = read('src/index.css').toString();

// Width and height from a PNG's IHDR chunk.
function pngSize(path) {
  const buf = read(path);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('manifest', () => {
  test('names, display, start URL and scope', () => {
    expect(manifest.name).toMatch(/Shift Handover/);
    expect(manifest.short_name).toBe('SHMS');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  test('theme and background colours are the design tokens', () => {
    expect(css).toMatch(new RegExp(`--color-brand-black: ${THEME_COLOR};`, 'i'));
    expect(css).toMatch(new RegExp(`--color-ink-50: ${BACKGROUND_COLOR};`, 'i'));
    expect(manifest.theme_color).toBe(THEME_COLOR);
    expect(manifest.background_color).toBe(BACKGROUND_COLOR);
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR}" />`);
  });

  test('icons: 192, 512 and a maskable 512, all present at their stated size', () => {
    const by = (purpose, sizes) => manifest.icons.find((i) => i.purpose === purpose && i.sizes === sizes);
    expect(by('any', '192x192')).toBeTruthy();
    expect(by('any', '512x512')).toBeTruthy();
    expect(by('maskable', '512x512')).toBeTruthy();
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(`public${icon.src}`);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  test('the icons are the generic monogram, not the airline logo', () => {
    const generator = read('scripts/generate-icons.mjs').toString();
    expect(generator).not.toMatch(/kenya-airways-logo/);
    expect(read('public/icons/icon.svg').toString()).toMatch(/>SH</);
  });
});

describe('index.html', () => {
  test('apple-touch-icon (180 px), favicon and iOS meta tags', () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />');
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(html).toContain('<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />');
    expect(existsSync(`${root}public/icons/icon.svg`)).toBe(true);
    for (const name of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style', 'mobile-web-app-capable']) {
      expect(html).toMatch(new RegExp(`<meta name="${name}" content="[^"]+" />`));
    }
  });

  test('the viewport covers the safe areas and the CSS pads them back in', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*" \/>/);
    for (const side of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${side}, 0px)`);
    const layout = read('src/components/Layout.jsx').toString();
    expect(layout).toMatch(/safe-top safe-x fixed inset-x-0 top-0/);
    expect(layout).toMatch(/pt-\(--chrome-top\)/);
  });
});
