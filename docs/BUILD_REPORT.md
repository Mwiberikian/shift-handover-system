# Build Report — Shift Handover Management System

Date: 2026-10-13. Baseline commit: `52273b2`. All figures below were measured on
the machine described in [Test environment](#test-environment); none were tuned
to meet a target.

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

## Part D — Requirements status

See [REQUIREMENTS_STATUS.md](REQUIREMENTS_STATUS.md) (status and evidence for every
requirement) and [TRACEABILITY.md](TRACEABILITY.md) (FR-to-test matrix). The requirement
texts are in [requirements.md](requirements.md), copied from Chapter 4 of the proposal.
