// IR-01 check: every interactive control offers at least 44 x 44 px of hit
// area, and no page scrolls sideways, at 320, 768 and 1280 px.
//
// Usage (client and API already running, seeded with synthetic data):
//   npm run check:touch
//   BASE_URL=http://localhost:5174 API_URL=http://localhost:4100/api npm run check:touch
//
// Env: BASE_URL (default http://localhost:5173), API_URL (default
// http://localhost:4000/api), PASSWORD (default the seed's demo password),
// BROWSER_CHANNEL (default msedge; 'chromium' uses Playwright's own build),
// REPORT (optional path for a JSON report). Exit code 1 if anything fails.
//
// Hit area: the control's own box. For a checkbox or radio input, the box of
// its <label> counts too, because clicking the label operates the control.
// Links inside running text (<p>) are listed separately as inline links,
// which WCAG 2.5.5 exempts; they are not counted as failures.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.PASSWORD || 'Password123!';
const CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const MIN = 44;
const WIDTHS = [320, 768, 1280];

const PAGES = [
  { name: 'login', path: '/login', account: null },
  { name: 'outgoing', path: '/outgoing', account: process.env.OUTGOING_ID || 'KQ1001' },
  { name: 'incoming', path: '/incoming', account: process.env.INCOMING_ID || 'KQ2002' },
  { name: 'supervisor', path: '/supervisor', account: process.env.SUPERVISOR_ID || 'KQ1003' },
  { name: 'admin', path: '/admin', account: process.env.ADMIN_ID || 'KQ9001' },
];

const SELECTOR = [
  'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=switch]',
  '[role=tab]', '[role=menuitem]', '[role=option]', '[tabindex]:not([tabindex="-1"])',
].join(',');

async function login(identifier) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: HTTP ${res.status}`);
  return (await res.json()).token;
}

// Runs in the page.
function measure({ selector, min }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return false;
    const own = getComputedStyle(el);
    // Visually hidden until focused (skip links): measured by the Tab check.
    if (own.clipPath === 'inset(50%)' || own.clip === 'rect(0px, 0px, 0px, 0px)') return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || n.hidden || n.inert) return false;
    }
    return true;
  };
  const union = (rects) => {
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { width: right - left, height: bottom - top };
  };
  const describe = (el) => {
    const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent
      || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    const role = el.getAttribute('role') || (el.tagName === 'INPUT' ? `input[${el.type}]` : el.tagName.toLowerCase());
    return `${role} "${label.replace(/\s+/g, ' ').trim().slice(0, 50)}"`;
  };

  const seen = new Set();
  const controls = [];
  const inline = [];
  for (const el of document.querySelectorAll(selector)) {
    if (seen.has(el) || !visible(el)) continue;
    // A focusable wrapper around a real control is measured as that control.
    if (el.matches('[tabindex]') && el.querySelector('input,button,select,textarea,a[href]')) continue;
    seen.add(el);
    if (el.matches('a[href]') && el.closest('p')) {
      inline.push(describe(el));
      continue;
    }
    const rects = [el.getBoundingClientRect()];
    if (el.matches('input[type=checkbox],input[type=radio]')) {
      for (const l of el.labels || []) rects.push(l.getBoundingClientRect());
    }
    const { width, height } = union(rects);
    controls.push({
      what: describe(el), width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10, ok: width >= min - 0.5 && height >= min - 0.5,
    });
  }
  const doc = document.documentElement;
  return {
    controls, inline, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
  };
}

async function main() {
  const browser = await chromium.launch(CHANNEL === 'chromium' ? {} : { channel: CHANNEL });
  const tokens = {};
  for (const p of PAGES) if (p.account) tokens[p.account] ??= await login(p.account);

  const results = [];
  for (const p of PAGES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      if (p.account) {
        await context.addInitScript((t) => sessionStorage.setItem('shms_token', t), tokens[p.account]);
      }
      const page = await context.newPage();
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const m = await page.evaluate(measure, { selector: SELECTOR, min: MIN });
      // The first Tab stop is usually a skip link that is hidden until focused.
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        return { what: `first Tab stop "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50)}"`, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
      });
      if (first) m.controls.push({ ...first, ok: first.width >= MIN - 0.5 && first.height >= MIN - 0.5 });
      const failures = m.controls.filter((c) => !c.ok);
      const hScroll = m.scrollWidth > m.clientWidth;
      results.push({
        page: p.name, path: p.path, width, url: page.url(), controls: m.controls.length, failures, inline: m.inline,
        horizontalScroll: hScroll, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth,
      });
      await context.close();
    }
  }
  await browser.close();

  let failed = 0;
  console.log(`IR-01 touch targets (min ${MIN} x ${MIN} px) and horizontal scroll — ${BASE_URL}\n`);
  console.log('page        width  controls  under 44 px  h-scroll  inline links');
  for (const r of results) {
    console.log(`${r.page.padEnd(11)} ${String(r.width).padStart(5)}  ${String(r.controls).padStart(8)}  ${String(r.failures.length).padStart(11)}  ${(r.horizontalScroll ? `YES (${r.scrollWidth})` : 'no').padStart(8)}  ${String(r.inline.length).padStart(12)}`);
    if (r.failures.length || r.horizontalScroll) failed += 1;
  }
  for (const r of results.filter((x) => x.failures.length)) {
    console.log(`\n${r.page} @ ${r.width}px:`);
    for (const f of r.failures) console.log(`  ${f.width} x ${f.height}  ${f.what}`);
  }
  if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(results, null, 2));
  console.log(failed ? `\nFAIL: ${failed} of ${results.length} page/width combinations` : `\nPASS: all ${results.length} page/width combinations`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 2; });
