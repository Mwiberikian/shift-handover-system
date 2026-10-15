# Build Report — Shift Handover Management System

Date: 2026-10-13, updated 2026-10-14 (Parts H–K, then P–R). Baseline commit: `52273b2`.
All figures below were measured on the machine described in
[Test environment](#test-environment); none were tuned to meet a target.

**All data behind every result in this report is synthetic (DR-11).** The seed
(`server/src/db/seeds/seed.js`, 13 invented users at `@shms.example`, records
prefixed `SYNTHETIC:`), the test fixtures (`@test.example`), the 30,000 load-test
drafts and every message, shift and email are invented. No Kenya Airways data,
staff or passenger information was used.

---

## Part A — Audit (state at `52273b2`, before any change)

**1. Is there any route or UI action that moves a record from `acknowledged` to `under_review`?**
No. The status exists in the enum and the DB trigger allows the transition
(`server/migrations/1790865288764_initial-schema.js:194`), and the supervisor
dashboard counts it (`server/src/modules/handovers/workflow.service.js:272`),
but no route sets it. `POST /:id/review` required `acknowledged` and went
straight to `closed` or `escalated` (`workflow.service.js:160`,
`handovers.routes.js:143`). The client only displays the status
(`client/src/components/ui/StatusBadge.jsx:25`, `client/src/pages/SupervisorPage.jsx:56`).

**2. What path prefix do the API routes use?**
`/api`, mounted per module in `server/src/app.js:14-26`, with a JSON 404
catch-all for unknown `/api` paths at `app.js:28`.

**3. Is there any export or print endpoint for a record?**
No. Nothing in `server/src` or `client/src` exports or prints a record.

**4. How do notifications reach the client, and what is the polling interval?**
By HTTP polling only (no websockets or SSE). The bell fetched the full
`GET /api/notifications` list every 30 s
(`client/src/components/shell/NotificationsMenu.jsx:15,108`). The message badge
polled `GET /api/messages/unread-count` every 30 s (`client/src/lib/unread.js:37`).
There was no notification unread-count endpoint, and polling continued while
the tab was hidden.

**5. Is there any code that sends email?**
No. There is no mail library in either `package.json` and no SMTP/mail code.
Notifications are in-app only: rows in `notification`, plus optional browser
desktop alerts (`client/src/lib/desktopAlerts.js`). The support email in
`client/.env` is only displayed.

**6. Does `client/` contain any tests?**
No. There were no test files and no test runner in `client/package.json`.

**7. Tables and API routes.**

Tables created by the migrations (16, plus node-pg-migrate's own `pgmigrations`):

| Migration | Tables |
|---|---|
| `1790865288764_initial-schema.js` | `handover_template` (:37), `department` (:47), `app_user` (:54), `shift` (:65), `handover_record` (:74), `task` (:93), `incident` (:103), `acknowledgement` (:113), `supervisor_review` (:122), `notification` (:131), `audit_log` (:140) |
| `1791100000000_access-requests.js` | `access_request` (:17) |
| `1791200000000_app-user-google-sub.js` | none (adds a column to `app_user`) |
| `1791300000000_messaging.js` | `message` (:25), `message_read` (:48) |
| `1791400000000_shift-reminders.js` | `shift_assignment` (:20), `reminder_log` (:26) |

API routes at baseline (49):

| Prefix | Routes | File |
|---|---|---|
| `/api/health` | `GET /` | `modules/health/health.routes.js` |
| `/api/auth` | `POST /login`, `GET /google/config`, `POST /google`, `POST /google/profile`, `GET /me` | `modules/auth/auth.routes.js` |
| `/api/handovers` | `GET /`, `GET /meta`, `GET /search`, `POST /`, `PATCH /:id`, `POST /:id/tasks`, `PATCH /:id/tasks/:taskId`, `POST /:id/incidents`, `POST /:id/submit`, `GET /:id`, `POST /:id/acknowledgement`, `POST /:id/query`, `POST /:id/clarify`, `POST /:id/review`, `POST /:id/resolve` | `modules/handovers/handovers.routes.js` |
| `/api/dashboard` | `GET /supervisor` | `modules/dashboard/dashboard.routes.js` |
| `/api/notifications` | `GET /`, `POST /:id/read` | `modules/notifications/notifications.routes.js` |
| `/api/messages` | `GET /inbox`, `GET /sent`, `GET /unread-count`, `POST /`, `GET /:id`, `POST /:id/read` | `modules/messages/messages.routes.js` |
| `/api/directory` | `GET /`, `GET /departments` | `modules/messages/messages.routes.js` |
| `/api/shifts` | `GET /mine`, `GET /`, `GET /:id/assignments`, `PUT /:id/assignments` | `modules/shifts/shifts.routes.js` |
| `/api/admin` | `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (deactivates), `GET /departments`, `GET /templates/:departmentCode`, `PUT /templates/:departmentCode`, `GET /access-requests`, `POST /access-requests/:id/approve`, `POST /access-requests/:id/reject` | `modules/admin/admin.routes.js` |
| `/api/access-requests` | `GET /departments`, `POST /` | `modules/accessRequests/accessRequests.routes.js` |

**8. Which of these exist?**

| Feature | Exists | Evidence |
|---|---|---|
| Dark/light theme | Yes | `client/src/theme/ThemeContext.jsx:20`, `components/shell/ThemeToggle.jsx` |
| Google sign-in | Yes (off unless `GOOGLE_CLIENT_ID` is set) | `server/src/modules/auth/auth.routes.js:34`, `client/src/components/shell/GoogleButton.jsx` |
| Messaging | Yes | `server/src/modules/messages/`, `client/src/pages/MessagesPage.jsx` |
| Shift roster | Yes | `client/src/pages/RosterPage.jsx`, `App.jsx:54`, `PUT /api/shifts/:id/assignments` |
| Shift reminders | Yes | `server/src/jobs/reminders.js`, started at `server/src/server.js:14` |
| Request Access | Yes | `client/src/pages/RequestAccess.jsx`, `App.jsx:36`, `POST /api/access-requests` |
| Help page | Yes | `client/src/pages/Help.jsx`, `App.jsx:37` |

---

## Part B — What was built

Every commit is authored by Mwiberikian, with no co-author or generated-by lines.
After each step all tests passed.

| # | Commit | Change | Tests after the step |
|---|---|---|---|
| B1 | `2b97653` | `POST /api/handovers/:id/open-review`: supervisor (own department) or admin; `acknowledged` → `under_review`, otherwise 409. Audit row `open_review` holds `opened_by` and `opened_at`. `review` now also accepts `under_review`. Open review button in the supervisor queue drawer; the queue lists `under_review` records too. | server 126/126 (new `handover.open-review.test.js`, 14 tests) |
| B2 | `c1fa9ad` | `GET /api/notifications/unread-count` (`{count, latest_id}`). The bell polls it every 5 s and refetches the list only when it changes; the message badge also polls every 5 s. Both pause while the tab is hidden (`client/src/lib/usePolling.js`). | server 131/131 (new `notifications.unread-count.test.js`, 5 tests) |
| B3 | `241d66a` | Vitest + React Testing Library (jsdom). Tests: login routes each role to its home; `RequireRole` redirects (signed out, expired token, wrong role); submit stays disabled until template-required fields and the incoming user are set; the 5 s polling hook. `RequireRole` and `DraftEditor` became named exports. | client 21/21, server 131/131 |
| B4 | `af5faaa` | `GET /api/handovers/:id/export[?download=1]`: record + tasks + incidents + acknowledgement + reviews + every audit entry for the record and its child rows, as JSON. Uses `getById`, so the access rules are identical. Print / export button on every record view opens `/handovers/:id/print` (print CSS, Download JSON). | server 143/143 (new `handover.export.test.js`, 12 tests), client 23/23 |
| B5 | `23097ee` | `scripts/backup.ps1` (`pg_dump -Fc` via `docker exec`, then `docker cp` to `backups/`, git-ignored) and `scripts/restore.ps1` (into a scratch DB whose name must end in `_scratch`/`_restore`; prints row counts and elapsed time). | server 143/143, client 23/23 |

Checks beyond the unit tests:
- B3: the client tests can fail. Temporarily removing the `disabled={!ready}`
  gate and the `RequireRole` role check made 6 tests fail; both were restored.
- B5: a restore of `shms_dev` matched the source on users, records, audit rows,
  user-defined triggers (8) and applied migrations (5). Restoring into
  `shms_dev` is refused.

Not verified:
- The print page was not printed from a real browser. It is covered by a jsdom test and a production build only.
- The Open review button was not clicked in a real browser. The endpoint is covered by server tests.

---

## Part C — Measurements

### Test environment

AMD Ryzen 5 5625U (6 cores / 12 threads), 13.9 GB RAM, Windows 11 Home 10.0.26200,
Node v24.21.0, PostgreSQL 15 in Docker Desktop (engine 29.8.2). One API process
(`node src/server.js`, default `pg` pool of 10, morgan request logging to a
file, reminders off). The load generator ran on the same machine.

### C1. Server test coverage (`jest --coverage`)

143 tests in 14 suites, all passing. Two views:

- **Files loaded by tests** (plain `jest --coverage` with the repo's config; `roots` is `tests/`):
  **86.61 % statements, 69.61 % branches, 90.43 % functions, 90.32 % lines.**
- **All of `server/src`**, including files no test loads (`server.js`, seed scripts):
  **77.85 % statements, 66.28 % branches, 86.66 % functions, 80.50 % lines.**

Per folder (statements / branches / functions / lines):

| Folder | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `src` (`app.js`; `server.js` 0 % in the all-files view) | 96.15 (71.42) | 50 (12.5) | 100 (50) | 100 (72.72) |
| `src/config` | 71.42 | 100 | 0 | 71.42 |
| `src/db` | 100 | 100 | 100 | 100 |
| `src/db/seeds` (all-files view only) | 0 | 0 | 0 | 0 |
| `src/jobs` | 76.36 | 53.84 | 85.71 | 76.74 |
| `src/middleware` | 71.15 | 64.28 | 100 | 77.77 |
| `src/modules/accessRequests` | 96.87 | 88 | 100 | 98.27 |
| `src/modules/admin` | 80.99 | 58.75 | 72.72 | 85.32 |
| `src/modules/auth` | 92.85 | 86.44 | 94.44 | 95.29 |
| `src/modules/dashboard` | 100 | 100 | 100 | 100 |
| `src/modules/handovers` | 82.63 | 67.18 | 91.66 | 87.86 |
| `src/modules/health` | 55.55 | 100 | 0 | 55.55 |
| `src/modules/messages` | 97.97 | 90.24 | 100 | 100 |
| `src/modules/notifications` | 95 | 50 | 100 | 100 |
| `src/modules/shifts` | 98.43 | 57.89 | 100 | 100 |
| `src/utils` | 93.75 | 66.66 | 100 | 100 |

Weak spots: `middleware/errorHandler.js` 23.5 % statements (Postgres error
mapping mostly untested); `modules/handovers/handovers.service.js` 76 % (draft
task updates and some error paths); `jobs/reminders.js` 76 % (scheduler
start-up); `health` 0 % functions.

Client tests: 23/23 passing (5 files). Client coverage was not measured.

### C2. Load test (autocannon 8, 60 connections, 60 s each)

Run against a copy of `shms_dev` (`shms_load_scratch`) pre-seeded with 30,000
Ground Ops drafts (one resolved task each) so every submit used a fresh
record. The department therefore held ~30,001 records during the GET test,
which returns up to 200 joined rows per call. Error rate = (non-2xx +
socket errors/timeouts) ÷ (responses + socket errors). Autocannon's default
10 s timeout applied.

| Scenario | Requests | Avg req/s | p50 | p90 | p97.5 | p99 | max | Errors | Error rate |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/auth/login` (KQ1001) | 747 × 200 | 12.45 | 4,493 ms | 4,588 ms | 8,717 ms | 9,579 ms | 9,877 ms | 5 timeouts (> 10 s) | **0.66 %** |
| `GET /api/handovers` (supervisor KQ1003) | 5,124 × 200 | 85.4 | 705 ms | 750 ms | 839 ms | 890 ms | 987 ms | 0 | **0 %** |
| `POST /api/handovers/:id/submit` (KQ1001) | 9,992 × 200 | 166.5 | 363 ms | 401 ms | 424 ms | 462 ms | 875 ms | 0 | **0 %** |

Notes:
- Login is limited by bcrypt at cost 12 (`BCRYPT_ROUNDS`, required by the
  proposal). Each hash runs on libuv's default 4-thread pool, so 60 concurrent
  logins queue. This is expected, but it is the slowest path by far.
- Submit integrity under load: 10,052 records reached `submitted` (60 were
  still in flight when the 60 s window closed), with 10,052 `submit` audit rows
  and 20,104 notifications (incoming user + supervisor each). No 409s or 500s.
- The first login run was discarded: a script error sent every request to `/`
  (404). The figures above are from the corrected run.

### C3. Notification delivery (submit → unread-count change)

Measured from sending `POST /submit` (outgoing KQ1001) until a poll of
`GET /api/notifications/unread-count` as the incoming user (KQ1002) returned
the higher count. The API was otherwise idle.

| Mode | Trials | min | p50 | p95 | max | mean | ≤ 5 s |
|---|---|---|---|---|---|---|---|
| Client-like: 5 s poll at a random phase per trial | 30 | 496 ms | 2,789 ms | 4,929 ms | 4,945 ms | 2,870 ms | **30 / 30** |
| Fast poll (50 ms), server-side visibility | 20 | 49 ms | 73 ms | 108 ms | 108 ms | 81 ms | 20 / 20 |

The notification row commits in the same transaction as the submit, so it is
visible as soon as submit returns. Delivery time is therefore set by the 5 s
poll interval. The worst case is about 5 s plus one poll round trip, so it can
exceed 5 s by that round trip under load. This was a script that copies the
client's polling loop. **It was not measured in a real browser**, and the
background-tab pause (tested in `usePolling.test.jsx`) means a hidden tab
updates only once it is shown again.

### C4. Backup and restore timing

Three runs each. "Wall" includes PowerShell start-up; "script" is the
elapsed time the script prints.

| Database | Dump size | Backup wall (script) | Restore wall (script) |
|---|---|---|---|
| `shms_dev` (15 users, 1 record, 399 audit rows) | 62.3 KB | 1.12 / 1.08 / 1.10 s (0.48 / 0.46 / 0.47 s) | 2.34 / 2.64 / 2.32 s (1.55 / 1.84 / 1.56 s) |
| `shms_load_scratch` after the load test (30,001 records, 11,321 audit rows) | 4,900 KB | 1.60 / 1.65 / 1.66 s (1.01 / 1.01 / 1.03 s) | 3.34 / 3.47 / 3.39 s (2.52 / 2.65 / 2.60 s) |

Each of the three restores of a database printed the same row counts. For
`shms_dev`, those counts were checked against the live database and matched.
For `shms_load_scratch`, only the record count (30,001) was checked against the
source. The scratch databases were dropped afterwards.

---

### C5. Login concurrency: libuv thread pool 4 vs 12

Same autocannon shape as C2 (`POST /api/auth/login` as KQ1001, 60 connections,
60 s, 10 s timeout). bcrypt cost unchanged at 12 (`server/src/config/constants.js:3`).
One API process on port 4100 against `shms_eval_scratch`: freshly migrated and seeded (13 synthetic users),
morgan logging to a file, reminders off. The load generator ran on the same machine.
Your own dev API (4000) and Vite (5173) were running but idle. The scratch Vite (5174)
used for the accessibility scan was also running. Runs went in this order: default ×1,
`UV_THREADPOOL_SIZE=12` ×2 (one process), default ×1 (after a restart).

| Run | Thread pool | 2xx | Avg req/s | p50 | p90 | p97.5 | p99 | max | Timeouts (> 10 s) | Error rate |
|---|---|---|---|---|---|---|---|---|---|---|
| C2 (earlier, `shms_load_scratch`) | 4 (default) | 747 | 12.45 | 4,493 ms | 4,588 ms | 8,717 ms | 9,579 ms | 9,877 ms | 5 | 0.66 % |
| Today, run 1 | 4 (default) | 819 | 13.65 | 4,343 ms | 4,513 ms | 4,577 ms | 4,723 ms | 5,007 ms | 18 | 2.15 % |
| Today, run 2 | 4 (default) | 725 | 12.09 | 4,594 ms | 4,700 ms | 7,189 ms | 8,071 ms | 8,674 ms | 8 | 1.09 % |
| Today, run 1 | **12** | 1,708 | **28.47** | **2,052 ms** | 2,204 ms | 2,553 ms | 3,518 ms | 3,971 ms | 1 | **0.06 %** |
| Today, run 2 | **12** | 1,701 | **28.35** | **2,081 ms** | 2,181 ms | 2,502 ms | 2,612 ms | 9,675 ms | 4 | **0.23 %** |

With 12 threads, throughput is about 2.2× higher and the median is about half. The gain
stops well short of 3× because the CPU has 6 physical cores. At 60 concurrent logins the median is still about 2 s, because
every login waits for a cost-12 hash. Latency percentiles count completed requests only, so
timed-out requests are not in them. The default-pool error rate varied from 0.66 % to 2.15 % across
three runs, so treat single runs as approximate. `UV_THREADPOOL_SIZE` is not set anywhere
in the repository. Using it would mean adding it to the start command or the environment.

---

## Part E — Parts H, J and K (2026-10-13/14)

One commit per numbered item, authored by Mwiberikian, no co-author or
generated-by lines. All server and client tests passed after every step.

| # | Commit | Change | Server | Client |
|---|---|---|---|---|
| H1 | `294307a` | Task description 10–1,000 characters (DR-04), create and update; client maxLength + counter | 173 | 24 |
| H2 | `1031979` | Rejected handover writes (400/422) audited as `submit_rejected` after the rollback, plus one log line (DR-12) | 177 | 24 |
| H3 | `d8efc69` | Messages `LIMIT`/`OFFSET` bound as parameters; page size clamped to 100; bad page 400 not 500 (IR-04) | 180 | 24 |
| H4 | `97e0f23` | One EAT formatter `YYYY-MM-DD HH:mm EAT`; incident input read as EAT (DR-02) | 180 | 54 |
| H5 | `37aa42f` | 44 × 44 px targets; Playwright `client/e2e/touch-targets.mjs` (IR-01) | 180 | 54 |
| H6 | `a2b094c` | Search shift filter (`shift_type`, `shift_id`), UI and tests (FR-16) | 190 | 56 |
| H7 | `f7d4d30` | Dashboard completion rate, current/preceding-shift window, "all records" toggle (FR-14) | 195 | 59 |
| H8 | `e0292a4` | Test: second open record → 409 (DR-05) | 199 | 59 |
| H9 | `a6d35bc` | Fault injection part-way through submit (NFR-10) | 203 | 59 |
| H10 | `5c93890` | `scripts/schedule-backup.ps1`, `backup.ps1 -Keep` (NFR-11, DR-09) | 203 | 59 |
| H11 | `dc029ee` | `UV_THREADPOOL_SIZE` defaults to min(12, CPUs) before any import | 205 | 59 |
| H12 | `efe81c0` | `engines` node >=18; CI on Node 18/20/22 with postgres:15 (NFR-18) | 205 | 59 |
| H13 | `7c064f2` | Temporary password shown once; `must_change_password`; `POST /api/auth/change-password` (NFR-05) | 215 | 66 |
| H14 | `9ce311a` | Google sign-in described in one paragraph (README) | 215 | 66 |
| J15 | `98a0fef` | `notify()`: the only code that inserts notifications (IR-05) | 221 | 66 |
| J16 | `b1520ab` | SMTP gateway (nodemailer 9.1.1), env config, domain allowlist, Mailpit (IR-05) | 229 | 66 |
| J17 | `80453f6` | `email_outbox`, sending in the jobs tick, 3 retries at 1/2/4 min, outcome on the notification (IR-06) | 238 | 66 |
| J18 | `891f8a3` | Degraded mode; failed emails on the supervisor dashboard (IR-07) | 243 | 68 |
| J19 | `cbf0d3f` | Email content rules, per-user opt-out, eligible types | 253 | 70 |
| J20 | `786ab7e` | "Send as" System notification / Email / Both | 268 | 73 |
| K21 | `3aef461` | Add to Google Calendar and Download .ics; My shifts page | 277 | 76 |
| — | `e9a0ca1` | Fix: header at 320 px after the account menu (found by the stricter touch check) | 277 | 76 |
| K22 | `d8ba9a4` | Private calendar subscription feed, hashed revocable token | 285 | 77 |
| K23 | `f810696` | Note that calendar data leaves the system | 285 | 79 |

What each feature does and does not do: [FEATURES_ADDED.md](FEATURES_ADDED.md).

Notes:
- H11: `server.js` now prints the pool size it started with. The default is applied before
  `dotenv`; a value in `.env` or the environment still wins.
- H13: the temporary password is held only in the API's memory for 10 minutes. A restart in that
  window loses it; the admin then sets a new password.
- J16: nodemailer 10 requires Node 20, so 9.1.1 (engines >= 6) was pinned to avoid another
  Node 18 blocker. A message sent through the real transport arrived in Mailpit.
- K21–K22: the ICS writer is hand-written (`server/src/utils/ics.js`); no dependency was added.
- Not done: no real SMTP provider was used; the daily backup task was tested with a temporary
  task and removed, so **"SHMS daily backup" is not registered on this machine**.

### C1 (update). Server test coverage at `f810696`

285 tests in 33 suites, all passing. `jest --coverage --collectCoverageFrom='src/**/*.js'`
(all of `server/src`, including the seed scripts, and `server.js`, which the thread-pool test only
runs in a child process):
**93.31 % statements, 83.44 % branches, 96.31 % functions, 95.77 % lines.**
The default `jest --coverage` view (files loaded by tests, including test helpers):
93.50 % / 83.37 % / 96.48 % / 95.90 %.

### C6. Login load after the thread-pool default (H11)

Same shape as C2/C5: `POST /api/auth/login` as KQ1001, autocannon 8.0.0, 60 connections, 60 s,
10 s timeout. One API process on port 4100 against `shms_eval_scratch` (seeded, 13 synthetic users),
morgan logging to a file, reminders off. Also running, idle: the dev API (4000), dev Vite (5173),
scratch Vite (5174). Load generator on the same machine. Nothing set `UV_THREADPOOL_SIZE` except
where stated.

| Run | Thread pool | 2xx | Avg req/s | p50 | p90 | p97.5 | p99 | max | Timeouts | Error rate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | default, now 12 (12 logical CPUs) | 1,538 | 25.64 | 2,255 ms | 2,343 ms | 3,248 ms | 4,170 ms | 4,880 ms | 4 | 0.26 % |
| 2 | default, now 12 | 1,513 | 25.22 | 2,289 ms | 2,365 ms | 2,636 ms | 3,254 ms | 3,786 ms | 9 | 0.59 % |
| 3 | forced `UV_THREADPOOL_SIZE=4` | 688 | 11.47 | 4,823 ms | 4,922 ms | 8,195 ms | 8,974 ms | 9,519 ms | 9 | 1.29 % |

**Against C5:** the new default reproduces C5's 12-thread result without any setting: about 2.2×
the throughput of 4 threads (25.4 vs 11.5 req/s in the same session) and half the median (2.27 vs
4.82 s). It is about 10 % below C5's 28.4 req/s / 2.07 s median for 12 threads. This session had
three other dev processes running, and run-to-run spread in C5 was of the same order, so treat the
gap as noise rather than a regression. Forcing 4 threads matches C5's default runs (12.1–13.7 req/s).
At 60 concurrent logins the median is still over 2 s, because each login waits for a cost-12 hash.

### C5b. Scheduled backup check (H10)

`scripts/schedule-backup.ps1 -TaskName 'SHMS backup TEST (temporary)' -Keep 2 -OutDir <temp> -RunNow`
registered a daily task, ran it once (last result 0), wrote a 62.3 KB dump of `shms_dev` and appended
the log; `-Unregister` then removed it. `backup.ps1 -Keep 3` against a folder with five old dumps,
one dump of another database and an unrelated file deleted exactly the three oldest dumps of `shms_dev`.

### C7. Touch targets and horizontal scroll (IR-01)

`client/e2e/touch-targets.mjs` (Playwright 1.56.1, installed Microsoft Edge, headless), seeded scratch
instance. Measures every button, link, input, select, checkbox (with its label) and radio, plus the
first Tab stop, at 320, 768 and 1280 px.

| | Before H5 | Final (`f810696`) |
|---|---|---|
| Page/width combinations passing | 0 / 15 | **15 / 15** |
| Controls under 44 × 44 px | 3–41 per combination (e.g. buttons 32–36 px, inputs 36 px, radios 24 px, skip link 24 × 16) | 0 |
| Horizontal scroll | none | none |
| Inline links in running text (exempt, listed) | 2 on login | 2 on login |
| Controls reached only by scrolling a table sideways (listed) | not checked | admin users table: 26 at 320 px, 13 at 768 px |

The script was tightened during K21: a control partly outside the viewport now fails. That caught
the account menu pushing Log out off-screen at 320 px (fixed in `e9a0ca1`). Not covered: messages,
roster, my shifts, help and landing pages; dialogs and drawers in their open state; other browsers.

### NFR-18. CI on Node 18, 20 and 22

`.github/workflows/ci.yml`, run 38471103301 on `f810696`
(https://github.com/Mwiberikian/shift-handover-system/actions/runs/38471103301):

| Job | Node 18 | Node 20 | Node 22 |
|---|---|---|---|
| server (npm ci, npm test, postgres:15) | **fail** | pass | pass |
| client (npm ci, npm test) | **fail** | **fail** | pass |

Cause, reproduced locally in `node:18` and `node:20` containers: the server's test setup runs
`node-pg-migrate` 9, which needs Node 20 (`yargs parser supports a minimum Node.js version of 20`),
so migrations cannot run on 18; the API itself (`app.js`, `node-cron`, `google-auth-library`) loads on
18. The client test stack needs Node 22 (`jsdom` 30: `webidl.util.markAsUncloneable is not a
function` on 20). Dependencies that declare newer engines: `google-auth-library` 11 (>=22),
`node-cron` 4 and `node-pg-migrate` 9 (>=20), `vite` 8 (>=20.19), `vitest` 5 and `jsdom` 30 (>=22.12).
Options: pin older majors that support Node 18 (e.g. `node-pg-migrate` 7, `vitest` 2 with
`jsdom` 24), or accept Node 22 as the floor, which would conflict with NFR-18 as written.

**Decision (2026-10-15): Node 22 is the floor.** Both `package.json` files (and their lockfiles)
now declare `"engines": {"node": ">=22"}` and CI runs on Node **22 and 24**. Node 18 and 20 are
dropped because:
- both are end of life: Node 18 since 30 April 2025, Node 20 since 30 April 2026, so neither gets
  security fixes;
- the dependencies require newer versions: `node-pg-migrate` 9, `node-cron` 4 and `vite` 8 need
  Node 20 or later, and `google-auth-library` 11, `vitest` 5 and `jsdom` 30 need Node 22 or later.

Pinning older majors would mean running unsupported releases on an unsupported runtime. This
**departs from NFR-18 as written** ("Node.js 18 or later"), so NFR-18 stays Partly met
(REQUIREMENTS_STATUS). `server/tests/node-version.test.js` checks the engines fields, the CI
matrix and the Docker base image.

## Part F — Parts P, Q and R: hosting, installable app, sync and push (2026-10-14)

One commit per numbered item, authored by Mwiberikian, no co-author or
generated-by lines. All server and client tests passed after every step. The
untracked, unfinished `server/src/modules/reports/` (Part L) was left out of
every commit.

| # | Commit | Change | Server | Client |
|---|---|---|---|---|
| — | `8a1f574` | Starting point (after M3) | 316 | 79 |
| P1 | `ad25d60` | `server/Dockerfile` (node 22-alpine, user `node`, health check), `.dockerignore`; `node-pg-migrate` moved to dependencies for the release command | 322 | 79 |
| P2 | `6cffb6c` | `CLIENT_ORIGIN` list, trust proxy, refuse to start in production on a missing or `change_me` JWT secret | 333 | 79 |
| P3 | `d359e66` | `docs/DEPLOY.md`; test that its env table covers every variable the server reads | 337 | 79 |
| Q1 | `417d345` | Manifest, monogram icons, apple-touch-icon, meta tags, safe-area insets | 337 | 85 |
| Q2 | `f5c7514` | Service worker: shell-only precache, API NetworkOnly; offline banner; update prompt | 337 | 95 |
| Q3 | `3346758` | "Install app" item; iOS Share → Add to Home Screen hint | 337 | 99 |
| Q4 | `ae98d41` | Bottom tab bar per role, Me sheet, tables as cards, 16 px inputs, bars above the tabs | 337 | 110 |
| R1 | `9ffaa8f` | `app_user.theme_preference`; preferences synced through the server | 345 | 115 |
| R2 | `e0a6eae` | Refetch on focus / tab shown / online / new notification; "Updated just now" | 345 | 123 |
| R3 | `c7b7ec2` | Web Push channel, `push_subscription`, VAPID script, per-device switch; seed fixed for the new table | 368 | 131 |
| R4 | `9e84825` | `client/e2e/sync.mjs` (two browser contexts) | 368 | 131 |
| — | `1d49bca` | Client tests on half the cores (`maxWorkers: '50%'`): three typing-heavy tests passed alone in about 2 s but went past 5 s with one jsdom fork per core on a busy machine; no test or timeout changed | 368 | 131 |
| R5 | `c2a28e4` | Lighthouse and axe fixes: robots.txt, logo width/height, Google config no longer a 503; `client/e2e/axe-phone.mjs` | 368 | 131 |
| T | this commit | DEPLOY, FEATURES_ADDED, REQUIREMENTS_STATUS, TRACEABILITY, this report | 368 | 131 |

Notes:
- P1: the image was built and run against a scratch database: `id` → `uid=1000(node)`, health
  `healthy`, `/api/health` 200, and `docker run … npm run migrate up` applied all migrations.
- R3: adding `push_subscription` broke `npm run seed` (its TRUNCATE did not list the new table).
  Found while preparing R4, fixed in the same commit, and `seed.truncate.test.js` now checks
  that the seed and the test reset list every table.
- R5: `GET /api/auth/google/config` now answers 200 `{ "client_id": null }` when Google sign-in
  is off, instead of 503 (the browser logged that 503 as a console error on every sign-in page;
  Lighthouse best-practices). The sign-in endpoints still answer 503. One assertion in
  `auth.google.test.js` changed with it; README updated.
- R2: a first version of `RefreshOnReturn.test.jsx` ran the inbox test after tests that used fake
  timers; that combination hung its worker with React "Maximum update depth exceeded" warnings,
  and the orphaned worker kept a CPU busy for about 40 minutes until it was found and stopped
  (it was part of the load behind the client timeouts above). The inbox test now has its own
  file with real timers (`RefreshScreens.test.jsx`). The cause inside the combination was not
  pinned down; in the browser runs (C9) the inbox refetched normally with no runaway rendering.
- Not built: the Reports and Live tabs (no screens yet), so R4 step 3 is BLOCKED (C9).

### C8. Server test coverage at the end of Part R

368 tests in 42 suites, all passing, at `c2a28e4`. `jest --runInBand --coverage --collectCoverageFrom='src/**/*.js'
--collectCoverageFrom='!src/modules/reports/**'` (the untracked, unfinished reports service is excluded; it is
not in any commit): **93.47 % statements, 83.54 % branches, 96.21 % functions, 96.02 % lines**
(1,675 / 1,792 statements). At `f810696` it was 93.31 % statements (C1 update).

### C9. Sync between a desktop and a phone (R4)

`client/e2e/sync.mjs`, Playwright 1.56.1 driving installed Microsoft Edge, headless. Two
browser contexts: desktop 1280 × 800, phone 390 × 844 (mobile, touch, DPR 3). Dev client
(Vite) on :5300 against an API on :4300 and a scratch database `shms_e2e`, freshly seeded
(synthetic) before each run; reminders off. The clock starts when the submit (or preference)
response reaches the desktop browser.

| Step | Run 1 | Run 2 | Run 3 | Run 4 | Limit |
|---|---|---|---|---|---|
| 1a. Outgoing submits on desktop → bell badge on the incoming phone | 3,442 ms | 2,930 ms | 3,438 ms | 3,425 ms | 5,000 ms |
| 1b. … → the record and its summary on the phone, no reload | 3,444 ms | 3,443 ms | 3,439 ms | 3,426 ms | 5,000 ms |
| 2. Theme changed on desktop → dark on the phone after a reload (reload included) | 488 ms | 508 ms | 501 ms | 527 ms | — |
| 3. Session started on the phone → supervisor live board | BLOCKED | BLOCKED | BLOCKED | BLOCKED | 5,000 ms |

Step 1 is bounded by the 5 s poll: the badge appears at the first unread-count poll after the
commit, and the inbox refetches straight after (R2), so 1b trails 1a by a few milliseconds when
the badge is late in its cycle. Step 3: the session started from the phone (`POST
/api/sessions/start` 201, held by `GET /api/sessions/mine` within 239–251 ms), but there is no
live board screen or API for a supervisor to see it on; that is Part M, not built.

### C10. Lighthouse and axe at the phone viewport (R5)

Production build (`vite build`, `VITE_API_URL` → :4300) served by `vite preview` on :5301.

**Lighthouse 11.7.1** (the last version with the PWA category; Lighthouse 12 removed it), headless
Edge, default mobile emulation and simulated throttling. Only the public pages can be audited
without signing in.

| Page | Performance | Accessibility | Best practices | SEO | PWA |
|---|---|---|---|---|---|
| `/login`, before R5 fixes | 89 | 100 | 96 | 92 | 100 |
| `/login`, after | 91 | 100 | 100 | 100 | 100 |
| `/` (landing), before | 88 | 100 | 100 | 92 | 100 |
| `/` (landing), after | 89 | 100 | 100 | 100 | 100 |

Failures and what was done:

| Audit | Page | Cause | Ours? | Action |
|---|---|---|---|---|
| errors-in-console | login | 503 from `/api/auth/google/config` with Google sign-in off | yes | Fixed: config answers 200 with `client_id: null` |
| robots-txt (39 errors) | both | No `robots.txt`, so the SPA fallback served `index.html` | yes | Fixed: `client/public/robots.txt` (app screens disallowed) |
| unsized-images | both | Logo `<img>` without width and height | yes | Fixed: intrinsic 160 × 30 (the logo's aspect ratio); CSS still sets the drawn size |
| uses-responsive-images | both | Page photos (WebP, 96–219 KiB to save) larger than a phone shows | yes | **Not fixed**: needs smaller variants of each photo and `srcset`; a performance opportunity, not a pass/fail audit |
| unused-javascript | both | About 81–85 KiB of the first-load JavaScript unused on these pages | yes | Not fixed (opportunity) |
| uses-rel-preconnect | login | API on another origin | yes | Not fixed: the origin is a build-time variable (opportunity) |
| FCP 2.5–2.6 s, LCP 3.0–3.1 s, Speed Index 2.8–3.5 s | both | Simulated slow 4G on a local preview | — | Reported only |

PWA checks passed on both pages (installable manifest, service worker, maskable icon, themed
address bar, splash screen, viewport). Chromium's own check, `Page.getInstallabilityErrors` over
CDP in a persistent Edge profile, returned **no errors** (in a throwaway context it reports only
`in-incognito`, which is the test browser, not the app). Also checked in Edge: after browsing
three signed-in screens, Cache Storage held 41 shell files, **0 API responses and 0 photos**;
with the network off, `/supervisor/queue` loaded from the cache and showed "You are offline.
Changes cannot be saved."

**axe-core 4.11.0** (`client/e2e/axe-phone.mjs`, rules tagged WCAG 2.0/2.1/2.2 A and AA), 390 × 844,
light and dark: landing, login, request access, outgoing, outgoing with the Me sheet open, my
shifts, incoming, incoming history, messages, supervisor overview, review queue, roster, admin
users, templates and requests. **30 / 30 combinations, 0 violations**, before and after the R5
fixes. Keyboard-only operation was not tested.

**Touch targets** (`client/e2e/touch-targets.mjs`, same instance as C9) after Q4: **15 / 15**
page/width combinations pass, no horizontal scroll. The first run after Q4 failed admin at
320 px (346 px wide: the user cell's 12rem minimum inside the new card); fixed before Q4 was
committed.

## Part G — Parts L and M: shift reports, more workers, sessions and the live board (2026-10-15)

### C11. Live board load (M7)

`GET /api/supervisor/live` as supervisor KQ1003, autocannon 8.0.0 driven from a script that records
every response time (autocannon's own summary has no p95), **30 connections, 60 s**, 10 s timeout.
One API process on :4100 (`UV_THREADPOOL_SIZE` 12, morgan logging to a file, reminders off, the
jobs tick on) against `shms_eval_scratch`, freshly seeded with the **57-user synthetic seed (M1)**
just after 18:00 EAT, as the night shift began. The board it returns: Ground Operations, night shift, 6 rostered workers (2 with a
seeded live session, 4 not started), about 2.75 KB of JSON. Also running, idle: Vite on :5174 and
Docker (Postgres 15, Mailpit). Load generator on the same machine (see Test environment).

| Run | Responses | Avg req/s | p50 | p90 | p95 | p99 | max | Errors / timeouts / non-2xx | Error rate |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 16,670 | 277.8 | 105.0 ms | 118.4 ms | 123.9 ms | 147.8 ms | 251.1 ms | 0 / 0 / 0 | 0 % |
| 2 | 17,378 | 289.6 | 101.8 ms | 112.2 ms | 115.6 ms | 124.9 ms | 235.3 ms | 0 / 0 / 0 | 0 % |
| 3 | 17,311 | 288.5 | 101.8 ms | 114.0 ms | 118.1 ms | 126.3 ms | 237.0 ms | 0 / 0 / 0 | 0 % |

Each request runs seven queries (department, current shift, roster, then sessions, timers, task
counts, records, activity and incidents for the whole roster at once) plus the authentication
lookup. With 30 requests always in flight, the median is set by queueing (30 / 290 per second
≈ 103 ms); one request at a time on the idle server took 13–17 ms end to end (curl, 10 requests).
The board polls every
5 s, so 290 requests a second is about 1,450 open boards. Not measured: a department with many
more rostered workers, or boards polled together with other traffic.

### C12. Sync between a desktop and a phone, with the live board (R4 rerun)

`client/e2e/sync.mjs` as in C9 (Playwright 1.56.1, installed Edge, headless; desktop 1280 × 800,
phone 390 × 844), now with step 3 built: the supervisor's live board is open on the desktop; a
rostered worker who has not started (chosen from the board; KQ1024 in this run) taps **Start
shift** on the phone and accepts the first-use notice; the clock starts when the start response
reaches the phone and stops when the desktop row reads "Working". Dev client (Vite) on :5174
against the API on :4100, `shms_eval_scratch` freshly seeded, right after C11. One run (step 1
needs a fresh seed to run again).

| Step | Time | Limit |
|---|---|---|
| 1a. Outgoing submits on desktop → bell badge on the incoming phone | 3,432 ms | 5,000 ms |
| 1b. … → the record and its summary on the phone, no reload | 3,432 ms | 5,000 ms |
| 2. Theme changed on desktop → dark on the phone after a reload (reload included) | 467 ms | — |
| 3. Session started on the phone → "Working" on the supervisor's live board | 3,920 ms | 5,000 ms |

All four pass. Steps 1 and 3 are bounded by the 5 s polls (the bell's unread count and the
board), so each lands somewhere in 0–5 s depending on where in its cycle the change falls.

---

## Part D — Requirements status

See [REQUIREMENTS_STATUS.md](REQUIREMENTS_STATUS.md) (status and evidence for every
requirement) and [TRACEABILITY.md](TRACEABILITY.md) (FR-to-test matrix). The requirement
texts are in [requirements.md](requirements.md), copied from Chapter 4 of the proposal.
