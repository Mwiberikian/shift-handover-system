// Generates the installable-app icons (Part Q1) from a generic "SH" monogram.
// Deliberately not the airline logo: the app icon is ours, the logo is a
// trademark (src/assets/LOGO.md).
//
//   npm run icons            (Edge; BROWSER_CHANNEL=chromium for Playwright's own)
//
// Writes public/icons/: icon.svg (favicon), pwa-192.png, pwa-512.png,
// maskable-512.png (content inside the 80% safe zone, full-bleed background)
// and apple-touch-icon.png (180 px, square: iOS rounds the corners itself).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = (name) => `${root}public/icons/${name}`;
const font = readFileSync(`${root}node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`).toString('base64');

// Token values from src/index.css: brand-black, brand-red, white.
const BLACK = '#0d0d0d';
const RED = '#ed1c24';

// The monogram on a 512 x 512 canvas. `scale` shrinks the letters and bar
// about the centre (maskable icons keep everything inside the middle 80%).
function monogram({ radius, scale = 1, embedFont = true }) {
  const fontFace = embedFont
    ? `<style>@font-face{font-family:Mono;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;}</style>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${fontFace}<rect width="512" height="512" rx="${radius}" fill="${BLACK}"/>
<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
<text x="256" y="300" text-anchor="middle" font-family="${embedFont ? 'Mono, ' : ''}Inter, 'Segoe UI', Arial, sans-serif" font-weight="750" font-size="224" letter-spacing="-8" fill="#ffffff">SH</text>
<rect x="156" y="350" width="200" height="22" rx="11" fill="${RED}"/>
</g>
</svg>`;
}

const ICONS = [
  { file: 'pwa-192.png', size: 192, svg: monogram({ radius: 96 }) },
  { file: 'pwa-512.png', size: 512, svg: monogram({ radius: 96 }) },
  { file: 'maskable-512.png', size: 512, svg: monogram({ radius: 0, scale: 0.72 }) },
  { file: 'apple-touch-icon.png', size: 180, svg: monogram({ radius: 0, scale: 0.85 }) },
];

// The favicon stays tiny: no embedded font, system sans instead.
writeFileSync(out('icon.svg'), `${monogram({ radius: 96, embedFont: false })}\n`);

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, svg } of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(out(file), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    console.log(`wrote public/icons/${file} (${size} x ${size})`);
  }
} finally {
  await browser.close();
}
