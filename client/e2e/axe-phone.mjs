// R5 accessibility check: axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on each
// role's screens at the phone viewport (390 x 844), in light and dark themes,
// plus the Me sheet opened from the tab bar and a worker's detail on the live
// board. Needs the synthetic seed (npm run seed): the report screen opens the
// newest report in the supervisor's department list.
//
//   BASE_URL=http://localhost:5301 API_URL=http://localhost:4300/api node e2e/axe-phone.mjs
//
// Env: BASE_URL, API_URL, PASSWORD, BROWSER_CHANNEL (default msedge), REPORT
// (optional JSON path). Exit 1 if any violation is found.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.PASSWORD || 'Password123!';
const CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const SCREENS = [
  { name: 'landing', path: '/', account: null },
  { name: 'login', path: '/login', account: null },
  { name: 'request-access', path: '/request-access', account: null },
  { name: 'outgoing', path: '/outgoing', account: 'KQ1001' },
  { name: 'outgoing-me-sheet', path: '/outgoing', account: 'KQ1001', me: true },
  { name: 'my-shifts', path: '/shifts', account: 'KQ1001' },
  { name: 'incoming', path: '/incoming', account: 'KQ1002' },
  { name: 'incoming-history', path: '/incoming/history', account: 'KQ1002' },
  { name: 'messages', path: '/messages', account: 'KQ1002' },
  { name: 'supervisor', path: '/supervisor', account: 'KQ1003' },
  { name: 'supervisor-queue', path: '/supervisor/queue', account: 'KQ1003' },
  { name: 'roster', path: '/supervisor/roster', account: 'KQ1003' },
  { name: 'admin-users', path: '/admin/users', account: 'KQ9001' },
  { name: 'admin-templates', path: '/admin/templates', account: 'KQ9001' },
  { name: 'admin-requests', path: '/admin/requests', account: 'KQ9001' },
  { name: 'reports-staff', path: '/reports', account: 'KQ1001' },
  { name: 'my-work', path: '/work', account: 'KQ1001' },
  { name: 'reports-department', path: '/reports', account: 'KQ1003' },
  {
    name: 'report', account: 'KQ1003',
    path: async (token) => {
      const res = await fetch(`${API_URL}/reports?scope=department&page_size=1`, { headers: { authorization: `Bearer ${token}` } });
      return `/reports/${(await res.json()).items[0].report_id}`;
    },
  },
  { name: 'live-board', path: '/supervisor/live', account: 'KQ1003' },
  { name: 'live-board-detail', path: '/supervisor/live', account: 'KQ1003', detail: true },
  { name: 'live-board-admin', path: '/admin/live', account: 'KQ9001' },
];

async function login(identifier) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: HTTP ${res.status}`);
  return (await res.json()).token;
}

const browser = await chromium.launch({ channel: CHANNEL });
const results = [];
try {
  for (const scheme of ['light', 'dark']) {
    for (const s of SCREENS) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme,
      });
      const token = s.account ? await login(s.account) : null;
      if (token) await ctx.addInitScript((t) => sessionStorage.setItem('shms_token', t), token);
      const page = await ctx.newPage();
      const path = typeof s.path === 'function' ? await s.path(token) : s.path;
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800); // page fade-in animation
      if (s.detail) {
        await page.getByRole('button', { name: /Open details/ }).first().click(); // phone: rows are cards
        await page.getByRole('dialog').getByRole('heading', { name: 'Timeline' }).waitFor();
        await page.waitForTimeout(400); // drawer slide-in
      }
      if (s.me) {
        await page.getByRole('button', { name: 'Me', exact: true }).click();
        await page.getByRole('dialog', { name: 'Me' }).getByRole('link', { name: 'Change password' }).waitFor();
        await page.waitForTimeout(400); // sheet slide-in
        if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/me-sheet-${scheme}.png` });
      }
      await page.addScriptTag({ content: AXE });
      const { violations } = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
      const found = violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
      results.push({ screen: s.name, scheme, violations: found });
      console.log(`${found.length ? 'FAIL' : 'ok  '} ${scheme.padEnd(5)} ${s.name}${found.map((v) => `\n       ${v.impact} ${v.id} (${v.nodes}): ${v.help} -> ${v.targets.join(' | ')}`).join('')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(results, null, 2)}\n`);
const failing = results.filter((r) => r.violations.length);
console.log(failing.length ? `FAIL: ${failing.length} of ${results.length} screen/theme combinations` : `PASS: ${results.length} screen/theme combinations, no violations`);
process.exit(failing.length ? 1 : 0);
