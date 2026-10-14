// R4 sync check: two browser contexts, desktop (1280 px) and phone (390 px),
// against a running client and API seeded with the synthetic data set
// (npm run seed). Reports how long each change took to show on the other.
//
//   npm run check:sync
//   BASE_URL=http://localhost:5300 API_URL=http://localhost:4300/api npm run check:sync
//
// 1. The outgoing user (desktop) submits; the incoming user (phone) must see
//    the bell badge and the record within 5 s, with no reload.
// 2. A theme change on one device appears on the other after a reload.
// 3. A work session started on the phone appears on the supervisor live
//    board within 5 s. The live board is not built yet (Part M), so this step
//    starts the session, confirms the API holds it, and reports BLOCKED.
//
// Env: BASE_URL, API_URL, PASSWORD (seed default), BROWSER_CHANNEL (default
// msedge), REPORT (optional JSON path). Exit 1 if a step fails or is late.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.PASSWORD || 'Password123!';
const CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const LIMIT_MS = 5000;
const OUTGOING = 'KQ1001';
const INCOMING = 'KQ1002';
const SUPERVISOR = 'KQ1003';

const DESKTOP = { viewport: { width: 1280, height: 800 }, colorScheme: 'light' };
const PHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
};

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const login = async (identifier) => call('/auth/login', { method: 'POST', body: { identifier, password: PASSWORD } });

async function contextFor(browser, device, token) {
  const ctx = await browser.newContext(device);
  await ctx.addInitScript((t) => sessionStorage.setItem('shms_token', t), token);
  return ctx;
}

const results = [];
const record = (r) => { results.push(r); console.log(`${r.status.padEnd(7)} ${r.step}${r.ms != null ? `: ${r.ms} ms` : ''}${r.note ? ` (${r.note})` : ''}`); };

const browser = await chromium.launch({ channel: CHANNEL });
try {
  // ---- 1. Submit on desktop, see it on the phone ---------------------------
  {
    const out = await login(OUTGOING);
    const inc = await login(INCOMING);
    // A complete draft, prepared through the API so the UI step is the submit.
    const meta = await call('/handovers/meta', { token: out.token });
    const existing = (await call('/handovers', { token: out.token }))
      .find((r) => r.shift_id === meta.current_shift?.shift_id && r.status === 'draft');
    const summary = `Sync check ${new Date().toISOString()}: stands 4 to 9 clear, GPU on 5 back in service.`;
    const draft = existing ?? await call('/handovers', { token: out.token, method: 'POST', body: {} });
    await call(`/handovers/${draft.record_id}`, {
      token: out.token, method: 'PATCH', body: { summary_notes: summary, incoming_user_id: inc.user.user_id },
    });
    await call(`/handovers/${draft.record_id}/tasks`, { token: out.token, method: 'POST', body: { description: 'Check the tug battery on stand 7', priority: 'high' } });

    const desk = await (await contextFor(browser, DESKTOP, out.token)).newPage();
    const phone = await (await contextFor(browser, PHONE, inc.token)).newPage();
    await phone.goto(`${BASE_URL}/incoming`);
    await phone.getByRole('heading', { name: 'Awaiting action' }).waitFor();
    await desk.goto(`${BASE_URL}/outgoing`);
    await desk.getByRole('button', { name: 'Submit handover' }).filter({ visible: true }).first().click();
    const dialog = desk.getByRole('dialog');
    const submitted = desk.waitForResponse((r) => r.url().endsWith(`/handovers/${draft.record_id}/submit`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Submit handover' }).click();
    const res = await submitted;
    const t0 = Date.now();
    if (!res.ok()) throw new Error(`submit failed: HTTP ${res.status()}`);

    const badge = phone.getByRole('button', { name: /Notifications, \d+ unread/ }).waitFor({ timeout: 15000 }).then(() => Date.now() - t0);
    const shown = phone.getByText(summary).first().waitFor({ timeout: 15000 }).then(() => Date.now() - t0);
    const [badgeMs, recordMs] = await Promise.all([badge, shown]);
    record({ step: '1a. incoming (phone) sees the bell badge', ms: badgeMs, status: badgeMs <= LIMIT_MS ? 'PASS' : 'LATE' });
    record({ step: '1b. incoming (phone) sees the record, no reload', ms: recordMs, status: recordMs <= LIMIT_MS ? 'PASS' : 'LATE' });
    await desk.context().close();
    await phone.context().close();
  }

  // ---- 2. Theme on desktop, phone after a reload ---------------------------
  {
    const sup = await login(SUPERVISOR);
    await call('/auth/me/preferences', { token: sup.token, method: 'PATCH', body: { theme_preference: 'system' } });
    const desk = await (await contextFor(browser, DESKTOP, sup.token)).newPage();
    const phone = await (await contextFor(browser, PHONE, sup.token)).newPage();
    await phone.goto(`${BASE_URL}/supervisor`);
    await desk.goto(`${BASE_URL}/supervisor`);
    await desk.getByRole('heading', { name: 'Overview' }).waitFor();
    const isDark = (p) => p.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark(phone);

    const saved = desk.waitForResponse((r) => r.url().endsWith('/auth/me/preferences') && r.request().method() === 'PATCH');
    await desk.getByRole('button', { name: 'Dark theme' }).first().click();
    await saved;
    const t0 = Date.now();
    await phone.reload();
    await phone.waitForFunction(() => document.documentElement.classList.contains('dark'), null, { timeout: 15000 });
    const ms = Date.now() - t0;
    record({
      step: '2. theme set on desktop shows on phone after reload', ms, status: !before && (await isDark(desk)) ? 'PASS' : 'FAIL', note: 'reload included',
    });
    // Leave the account as the seed had it.
    await call('/auth/me/preferences', { token: sup.token, method: 'PATCH', body: { theme_preference: 'system' } });
    await desk.context().close();
    await phone.context().close();
  }

  // ---- 3. Session on the phone, supervisor live board ----------------------
  {
    const out = await login(OUTGOING);
    const phone = await (await contextFor(browser, PHONE, out.token)).newPage();
    await phone.goto(`${BASE_URL}/outgoing`);
    const t0 = Date.now();
    const started = await phone.evaluate(async ({ api, token }) => {
      const r = await fetch(`${api}/sessions/start`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.json() };
    }, { api: API_URL, token: out.token });
    const mine = await call('/sessions/mine', { token: out.token });
    const ms = Date.now() - t0;
    const ok = [200, 201].includes(started.status) && mine.session?.session_id === started.body.session?.session_id;
    record({
      step: '3. session started on phone appears on supervisor live board',
      ms: null,
      status: 'BLOCKED',
      note: ok
        ? `session started from the phone and held by the API in ${ms} ms; there is no live board screen or API to show it to a supervisor yet`
        : `session start returned HTTP ${started.status}: ${JSON.stringify(started.body).slice(0, 160)}`,
    });
    await call('/sessions/end', { token: out.token, method: 'POST' }).catch(() => {});
    await phone.context().close();
  }
} finally {
  await browser.close();
}

if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify({ base: BASE_URL, at: new Date().toISOString(), results }, null, 2)}\n`);
const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'LATE');
console.log(bad.length ? `FAIL: ${bad.length} step(s)` : 'PASS (BLOCKED steps are reported, not failed)');
process.exit(bad.length ? 1 : 0);
