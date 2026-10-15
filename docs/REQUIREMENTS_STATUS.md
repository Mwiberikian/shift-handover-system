# Requirements Status — Shift Handover Management System

Date: 2026-10-14. Code state: `c2a28e4` (Parts P, Q and R, after Parts H–K and L1/M2/M3).
Requirement texts: [requirements.md](requirements.md), copied word for word from Chapter 4 of
the proposal. Draft FR-32..FR-34 (not in the proposal) are [below](#draft-requirements-fr-32fr-34-not-in-the-proposal).
Rows whose status changed are listed in [Status changes since `f810696`](#status-changes-since-f810696-parts-p-q-and-r)
and, for the earlier pass, [since `23097ee`](#status-changes-since-23097ee).

Test totals at the time of writing: **server 368/368 (42 suites), client 131/131 (22 files)**;
Playwright checks: touch targets **15/15** page/width combinations, axe at 390 px **30/30**
screen/theme combinations with 0 violations, two-context sync **3 pass + 1 blocked** steps (C9).
The untracked, unfinished `server/src/modules/reports/` is not part of any of this.
Figures marked "C1"–"C7" are from [BUILD_REPORT.md](BUILD_REPORT.md).
**All data behind every test and measurement here is synthetic (DR-11).**

Status meanings:
- **Met**: a test or a measurement shows it, or the cited code shows it.
- **Partly met**: some of the statement holds and some does not. The row says which.
- **Not met**: the code does not do it.
- **Unverified**: nothing in the repository shows it either way (usually because it needs people, browsers or a deployment).

Paths are relative to the repository root. `S/` = `server/`, `C/` = `client/src/`.

On DR-08 and IR-08: these were to be re-judged against revised wording in `docs/requirements.md`.
The file in the repository has the same DR-08 and IR-08 text as when it was added (`f9e7de4`;
`git log -p docs/requirements.md` shows no later change). They are judged against that text below.

---

## Functional requirements

| ID | Status | Evidence |
|---|---|---|
| FR-01 | Met | `S/src/modules/admin/admin.routes.js`, `admin.service.js:21-29` (non-admin roles need one department), `:131-133` (delete = deactivate). Tests: `admin.users.test.js` (all 8), `access-request.workflow.test.js`, `rbac.test.js` "a token for a deactivated account is rejected immediately". |
| FR-02 | Met | `S/src/modules/auth/auth.service.js:46-58` (staff number or email, bcrypt), `:26-44` (signed JWT). Every role router runs `requireAuth` first. Tests: `auth.login.test.js` (all 4), `rbac.test.js` "missing or invalid token is 401", `C/test/Login.test.jsx`. |
| FR-03 | Partly met | Handover data, shifts, calendar exports and the dashboard are department-scoped (`S/src/middleware/auth.js:67-72`, `handovers.service.js:143-168`, `workflow.service.js:24-32,273-284`, `shifts.service.js` `calendarShifts`). Tests: `rbac.test.js`, `handover.open-review.test.js`, `handover.export.test.js`, `handover.search.test.js` [department and role scoping], `calendar.download.test.js`. **Not met for:** directory, messages and department list (by design; see answer 10 below). |
| FR-04 | Met | `GET /api/handovers/meta` (`handovers.service.js:170-181`); submit checks the template server-side (`:341-365`). Tests: `handover.draft-content.test.js`, `handover.submit.test.js`, `C/test/DraftEditor.test.jsx`. |
| FR-05 | Met | `handovers.routes.js:70-91`, enums in `S/migrations/1790865288764_initial-schema.js:30-31`. Description 10–1,000 characters (DR-04). Tests: `handover.draft-content.test.js` [tasks (FR-05)], [task description length (DR-04)]. |
| FR-06 | Met | `handovers.routes.js:93-105`; `incident` columns `initial-schema.js:103-111`. Tests: `handover.draft-content.test.js` [incidents (FR-06)]. |
| FR-07 | Met | `handovers.service.js:353-365` (422 with `missing_fields`). Tests: `handover.submit.test.js`; `C/test/DraftEditor.test.jsx`. |
| FR-08 | Met | `handovers.service.js:306-339`. Tests: `handover.carryforward.test.js` (5); `handover.submit-fault.test.js` shows a failed submit carries nothing. |
| FR-09 | Met | `handovers.service.js:44-50`; trigger `initial-schema.js:164-244`. Tests: `handover.immutability.test.js` (11). |
| FR-10 | Met | `handovers.service.js:101-104` (`notifyRecord` through the notification service), called from submit. Tests: `handover.submit.test.js`, `notifications.unread-count.test.js`, `notify.service.test.js` "callers are unchanged in effect". |
| FR-11 | Met | `workflow.service.js:49-75`. Tests: `handover.incoming-view.test.js`. |
| FR-12 | Met | `workflow.service.js:107-137`, closure needs `acknowledged`. Tests: `handover.acknowledgement.test.js` (6). |
| FR-13 | Met | `workflow.service.js:139-186`. Tests: `handover.acknowledgement.test.js`, `email.content.test.js` (query and clarify notify). |
| FR-14 | **Met** | `workflow.service.js:316-446`: per department the counts, `acknowledgement_due/done/rate` (acknowledged or later ÷ submitted or later) and overdue items cover the **current and preceding shift** (the two most recent started shifts, `:331-344`); `?scope=all` counts everything; `older_outstanding` reports overdue records outside the window. `C/pages/SupervisorPage.jsx`: "Current and preceding shift / All records" toggle, acknowledgement-rate card and column. Tests: `dashboard.window.test.js` (5), `dashboard.supervisor.test.js` (3), `C/test/SupervisorOverview.test.jsx`. |
| FR-15 | Met | `workflow.service.js:205-266`. Tests: `handover.acknowledgement.test.js`, `handover.open-review.test.js`. |
| FR-16 | **Met** | `handovers.routes.js:36-49`, `workflow.service.js:289-312`: date range, department, **shift (`shift_type` day/night, `shift_id`)**, status, keyword. Search form: `C/pages/SupervisorPage.jsx` `Search` (Shift select; dates sent as EAT day bounds). Tests: `handover.search.test.js` (10), `C/test/SupervisorSearch.test.jsx` (2). |
| FR-17 | Partly met | `S/src/utils/audit.js`, called in the same transaction for every create, update, submit, acknowledge, query, clarify, review, resolve, login, admin and roster change; also rejected writes (`submit_rejected`), password changes, preference changes (theme and email, changed fields only), calendar-feed changes, push subscribe/unsubscribe (user agent only, never the endpoint) and the one-time password reveal. **Not audited:** system-generated notification rows and read receipts (`notifications.routes.js:42-50`, `messages.service.js:137-153`). |
| FR-18 | Met | `admin.service.js:180-219`. Tests: `admin.templates.test.js` (3). |
| FR-19 | Met | `S/src/jobs/reminders.js` rule 4a, `REMINDER_UNACK_ALERT_MINUTES`. Dashboard flag `workflow.service.js:372-381`. Tests: `shift-reminders.test.js`, `dashboard.supervisor.test.js`. The alert is now also emailed when email is on. |
| FR-20 | Met | `workflow.service.js:80-105`, `C/pages/PrintRecord.jsx`. Tests: `handover.export.test.js` (12), `C/test/PrintRecord.test.jsx` (2). Not printed from a real browser. |

## Non-functional requirements

| ID | Status | Evidence |
|---|---|---|
| NFR-01 | Partly met | API only: `GET /api/handovers` at 60 connections, p97.5 839 ms (C2). Page rendering under load not measured. |
| NFR-02 | Met | `POST /submit` at 60 connections: p99 462 ms, 0 errors (C2). Localhost. |
| NFR-03 | Met | Notification row commits with the submit; 30/30 within 5 s with the client's 5 s poll (C3). The email channel only queues inside that transaction, and push is sent after commit, so neither adds delay. **R4 (browser, two contexts):** submit on desktop → bell badge on a 390 px phone in 2.9–3.4 s, the record itself in 3.4 s, no reload (4 runs; BUILD_REPORT C9). |
| NFR-04 | Unverified | No 60-session comparison against a baseline. |
| NFR-05 | Partly met | bcrypt cost 12 for every stored password, including `POST /api/auth/change-password` (`auth.service.js:155-180`; test `auth.temporary-password.test.js` "bcrypt cost 12"). Hashes are kept out of responses and audit rows. The access-request approval **no longer returns the temporary password**; it is held only in memory and shown once to the approving admin (`accessRequests.service.js:77-118`, `S/src/utils/oneTimeSecrets.js`), the account must change it at first sign-in (`middleware/auth.js:34-36`), and it is never stored, logged or emailed (test "the password is in no database row and no audit entry"). **Still not met:** that one reveal response does carry the password in plain text, by design; the statement says "never … responses". |
| NFR-06 | Met | Fixed 30-minute expiry from sign-in (`auth.service.js:26-36`). Test: `auth.login.test.js`. |
| NFR-07 | Partly met | Every tested boundary is refused (`rbac.test.js`, `handover.search.test.js`, `calendar.download.test.js`, `messaging.send-as.test.js` role limits, `handover.export.test.js`, …). Cross-department messaging/directory allowed by design. |
| NFR-08 | Not met | Plain HTTP (`S/src/server.js`). The calendar feed URL, which carries its token, is therefore also sent unencrypted. Since Part P, `docs/DEPLOY.md` requires HTTPS from the host (and the installable app and push need it), and helmet sends `Strict-Transport-Security`; the code still neither serves nor enforces TLS, and nothing is deployed. |
| NFR-09 | Met | No delete/edit route for records or audit rows; triggers `initial-schema.js:164-261`. Tests: `handover.immutability.test.js`. |
| NFR-10 | Met | One `withTransaction` per submit. **Fault-injection test** `handover.submit-fault.test.js`: a forced error at the notification insert, at the `submit` audit row, and at the status change each leave the record a draft with no audit row, no notifications and no carried-forward tasks; making `withTransaction` commit on error fails 3 of its 4 tests. |
| NFR-11 | **Met** | Restore of a 30,001-record database in 3.4 s (C4). `scripts/schedule-backup.ps1` registers a daily Task Scheduler job running `backup.ps1 -Keep 14` (C5b: a temporary task ran with result 0 and wrote a dump). The 24-hour bound holds only while that job runs: it runs while the user is signed in and Docker is up, and catches up a missed run when it can. **The task is not registered on this machine**; run the script once to register it. |
| NFR-12 | Unverified | No usability walkthrough. |
| NFR-13 | Unverified | No SUS questionnaire. |
| NFR-14 | Partly met | axe-core 4.11.0, every WCAG 2.0/2.1/2.2 A and AA rule, **0 violations** on 15 screens × 2 themes at the 390 px phone viewport, including the Me sheet open (`C/../e2e/axe-phone.mjs`, BUILD_REPORT C10); earlier, 0 contrast violations on 7 views × 2 themes at 1280 px (answer 7). Lighthouse accessibility 100 on login and landing. Keyboard-only operation not tested. |
| NFR-15 | Unverified | Headless Edge only, at 320, 768, 1280 px (C7: renders, no horizontal scroll) and 390 px (R4, R5). Chrome, Firefox, Safari, real phones and widths to 1920 px not tested. |
| NFR-16 | Met | Separate `client/`, `server/`, Postgres container. Backend statement coverage **93.47 %** of `server/src` (C8, 368 tests; was 93.31 % at C1). |
| NFR-17 | **Met** | [TRACEABILITY.md](TRACEABILITY.md) maps **all 20** FRs to tests (FR-16 has `handover.search.test.js`), and the draft FR-32..FR-34 too. |
| NFR-18 | Partly met | Configuration is from environment variables (`S/.env.example`, `C/.env.example`; every variable the server reads is in `docs/DEPLOY.md`, checked by `deploy.docs.test.js`); `S/Dockerfile` (Node 22 Alpine) with migrations as a release command; production refuses to start on a missing or placeholder secret (`S/src/config/env.js`, `config.production.test.js`); both `package.json` files declare `"engines": {"node": ">=22"}` and `.github/workflows/ci.yml` runs both test suites on Node 22 and 24 with `postgres:15` (`node-version.test.js`). **Departs from the requirement as written:** Node 18 and 20 were dropped on 2026-10-15 because both are end of life and the dependencies need Node 20 or 22 (`node-pg-migrate` 9, `jsdom` 30, `vitest` 5, `google-auth-library` 11). On CI at `f810696`, Node 18 and 20 failed for exactly those reasons. See BUILD_REPORT Part E. |
| NFR-19 | Met | `workflow.service.js:205-266`, trigger `initial-schema.js:190-201`. Tests: `handover.acknowledgement.test.js`. |

## Data requirements

| ID | Status | Evidence |
|---|---|---|
| DR-01 | Met | `summary_notes`, `task`, `incident` (`initial-schema.js:74-111`). |
| DR-02 | **Met** | Storage: every temporal column is `timestamptz` (answer 1). Presentation: one formatter, `formatEAT` (`C/lib/format.js`), Intl with `timeZone: 'Africa/Nairobi'`, prints `YYYY-MM-DD HH:mm EAT` (and the date or time part alone); it replaced every `fmt`/`fmtDate`/`fmtTime`/`fmtNairobiTime` use. The incident "Occurred at (EAT)" input is read as EAT (`eatLocalToIso`), and search dates are sent as EAT day bounds. Tests: `C/test/format.test.js` with fixed instants under `Africa/Nairobi`, `UTC` and `America/New_York` (31). Notes: the zone is written "EAT", as specified, not as an ISO offset `+03:00`; lists still show relative labels ("5 min ago") with the full EAT time as a tooltip. |
| DR-03 | Met | Enums `initial-schema.js:26-33`; new `email_status_enum` (`1791600000000_email-outbox.js`). |
| DR-04 | **Met** | Task description 10–1,000 characters after trimming, on create and update (`handovers.routes.js:18-21`, `S/src/config/constants.js`); client `maxLength`/`minLength` and a counter (`C/pages/OutgoingPage.jsx`, `C/lib/limits.js`). Severity and time of occurrence required. Tests: `handover.draft-content.test.js` [task description length (DR-04)] at 9, 10, 1000, 1001 for create and update; `C/test/DraftEditor.test.jsx`. |
| DR-05 | Met | Partial unique index `handover_record_one_open_per_shift` → 409. **Now tested:** `handover.one-open.test.js` (4): second create 409, direct INSERT 23505, every open status blocks, a closed one does not. |
| DR-06 | Met | Every FK `ON DELETE RESTRICT`, including `email_outbox.notification_id` (`1791600000000_email-outbox.js`). |
| DR-07 | Partly met | Creator, acknowledger and reviewer kept; previous/new values audited for user actions. Not for read receipts or system notifications. |
| DR-08 | Partly met | Re-judged against the text in `requirements.md`. No interface hard-deletes records or audit entries (NFR-09), and nothing removes them, so they stay online beyond 24 months. **No archival after 24 months exists.** (Calendar exports and email never copy handover content out.) |
| DR-09 | Partly met | A full logical backup is now scheduled daily (`scripts/schedule-backup.ps1`, keeps 14) and restore is tested (C4). **No WAL archiving** (`docker-compose.yml` sets no `archive_mode`). |
| DR-10 | Partly met | No passenger data. More personal data than the five fields (answer 8); added since: `app_user.email_notifications`, `must_change_password`, `calendar_feed_hash` (a hash) and `email_outbox.to_address` (a work email, already held); since Part R, `app_user.theme_preference` and `push_subscription` (a push-service endpoint and keys per device, and the device's user agent string). The failed-email list shows names, not addresses. |
| DR-11 | **Met** | Seeds and fixtures are synthetic (`S/src/db/seeds/seed.js:4-6`, `SYNTHETIC:` prefixes, `@shms.example`, `@test.example`). BUILD_REPORT, this file, TRACEABILITY and FEATURES_ADDED now state that every result used synthetic data. |
| DR-12 | **Met** | Validation at the API (`S/src/middleware/validate.js`, `handovers.service.js:353-365`). **Every rejected handover write is now logged with its reason**: `S/src/utils/rejections.js` (router-level, `handovers.routes.js:189`) writes an `audit_log` row `submit_rejected` (user, record id, status, message, failing fields or missing template items; never the submitted values) in its own transaction after the rollback, and one log line. Tests: `handover.rejections.test.js` (4). |

## Interface and integration requirements

| ID | Status | Evidence |
|---|---|---|
| IR-01 | **Met** | Mobile-first base styles serve 320 px; below 768 px a bottom tab bar, card tables and 16 px inputs (Q4, `C/components/shell/TabBar.jsx`, `C/components/ui/Table.jsx`; tabs are 64 px tall). Re-measured after Q4: **15/15** again, no horizontal scroll (a 320 px overflow in the new admin cards was found by the script and fixed before the commit). `md` (768) and `xl` (1280) breakpoints are used. Buttons of every size, inputs, selects, checkbox labels, segmented radios, header icons, sidebar and utility-bar links, the brand link, the password toggle and the skip link are at least 44 × 44 px (`C/components/ui/Button.jsx`, `Field.jsx`, `SegmentedPicker.jsx`, `shell/*`). `C/../e2e/touch-targets.mjs` measured login, outgoing, incoming, supervisor and admin at 320/768/1280 px in Edge: **15/15 pass**, no horizontal scroll (C7). Exceptions reported, not failed: 2 inline links in running text on login (WCAG 2.5.5 exempts them), and the admin users table, whose Edit/Deactivate buttons (44 px) are reached by scrolling the table sideways at 320 and 768 px. |
| IR-02 | Partly met | REST + JSON with standard status codes (now also 410 and 429). Plain HTTP (NFR-08). |
| IR-03 | Met | Bearer JWT with `user_id`, `role`, `department_id`, `exp` (plus `pwd_change` while a temporary password is in use). Test: `auth.login.test.js`. |
| IR-04 | **Met** | Pooled `pg`. Every value is a `$n` parameter; **`LIMIT`/`OFFSET` in messages are now bound** (`messages.service.js:90,107`), page size is clamped to 100 and an out-of-range page is a 400 (`messages.routes.js:18-21`). Test: `messaging.test.js` [paging (IR-04)] including `page=99999999999999999999` → 400. Queries are still assembled from fixed SQL fragments (answer 5); none contains user input. |
| IR-05 | **Met** | One service interface: `notify()` (`S/src/modules/notifications/notify.js`) is the only code that inserts notifications (test scans the source); in-app is always delivered and channels (`registerChannel`) plug in behind it. SMTP channel: `email/channel.js`, `email/mailer.js` (`nodemailer`, config from env, off by default, domain allowlist), Mailpit in `docker-compose.yml`. Tests: `notify.service.test.js`, `email.mailer.test.js`, `email.content.test.js`. A third channel, Web Push (`push/push.js`), plugged in without changing any caller beyond naming it (`push.test.js`). |
| IR-06 | **Met** | `email/outbox.js`: up to 3 retries after 1, 2 and 4 minutes (base configurable), then `failed`; outcome written to `notification.email_status`/`email_status_at`. Test with a failing transport and a fake clock: `email.outbox.test.js` (9). |
| IR-07 | **Met** | The in-app row is written before, and independently of, the email; sending is outside the handover's transaction. Dashboard: `failed_emails` list and per-department count (`workflow.service.js:383-410`), "could not be delivered" card. Fault-injection tests `email.degraded.test.js` (5): in-app delivered and unread, record stays submitted and can be acknowledged, failures listed for that department only. |
| IR-08 | Partly met | Re-judged against the text in `requirements.md`: stable prefix `/api` (`S/src/app.js:14-28`) and a versioned export format (`shms.handover_record.v1`), but **no version in the API path** (e.g. `/api/v1`) and no published contract document. |
| IR-09 | Met | Local credential check in `auth.service.js`; Google sign-in reuses the same session issuer (`signSession`, `:26-36`). |

## Draft requirements FR-32..FR-34 (not in the proposal)

Drafted for Parts Q and R and written to match what the code does, not what
the brief asked for where the two differ (differences in the notes). They are
**not** in `requirements.md`, which holds only the proposal's text. FR-21..FR-31
have no draft text in this repository.

| ID | Draft statement | Priority (proposed) | Verification |
|---|---|---|---|
| FR-32 | The system shall be installable from a supported browser as a standalone application, with a web app manifest (name, short name "SHMS", start URL and scope `/`, theme and background colours, 192 px, 512 px and maskable icons) and a service worker that caches the application shell only and never an API response. When the device is offline the interface shall say that changes cannot be saved, and when a new version is available it shall offer to reload. The user menu shall offer installation when the browser allows it, and on iOS shall explain how to add the application to the home screen. Below 768 pixels the interface shall show a bottom tab bar for the user's role, linking only to screens that exist, and shall present tables as cards. | Medium | Testing and inspection (Lighthouse PWA, installability check) |
| FR-33 | The system shall store each user's theme (light, dark or follow the device) and email-alert preference on the server, return them at sign-in, and apply them on whichever device the user signs in or reloads, caching the theme on that device for its first paint. A change on one device shall appear on another device at its next sign-in or reload. | Low | Testing (two browser contexts) |
| FR-34 | Where push notifications are enabled by configuration, the system shall send a Web Push notification to each device on which the recipient has turned push on, for the notification types eligible for email, carrying only a title and a link into the application and no handover, report or message content. It shall send only after the change that caused it has been committed, ask for the browser's permission only when the user turns push on, and delete a device subscription that the push service reports as gone. | Medium | Testing (mocked push service) and demonstration on a device |

| ID | Status | Evidence |
|---|---|---|
| FR-32 | Met | Manifest and icons: `C/../pwa.config.js`, `C/../public/icons` (generic "SH" monogram, not the airline logo), `C/../index.html`. Service worker: shell-only precache (45 files, no photos), `NetworkOnly` for `/api/` on any origin and for any request with `Authorization` (`pwa.config.js` `isNetworkOnly`); the built `sw.js` was checked and Cache Storage held **0 API entries** after browsing three screens. Offline banner and update prompt: `C/components/shell/OfflineBanner.jsx`, `UpdatePrompt.jsx`, `C/pwa/registerSW.js`; offline in Edge the shell loaded from cache and the banner showed. Install: `C/pwa/install.js`, "Install app" in `C/components/shell/UserMenu.jsx`. Tab bar and cards: `C/components/shell/TabBar.jsx`, `nav.js` `TABS`, `C/components/ui/Table.jsx`. Lighthouse 11.7.1 **PWA 100** on `/login` and `/` (BUILD_REPORT C10); Chromium `Page.getInstallabilityErrors` returns none. Tests: `pwaManifest.test.js` (6), `pwaServiceWorker.test.jsx` (10), `InstallApp.test.jsx` (3), `InstallAppIOS.test.jsx` (1), `MobileLayout.test.jsx` (11). **Notes:** the brief's Reports and Live tabs are not shown because those screens do not exist (Parts L and M, unfinished); not installed on a real phone. |
| FR-33 | Met | `S/migrations/1792100000000_user-theme-preference.js` (check constraint), `S/src/modules/auth/auth.routes.js` `PATCH /me/preferences`, `auth.service.js` `PROFILE_SELECT`; `C/lib/preferences.js` (`PreferenceSync`, `useThemeSwitch`), `C/theme/ThemeContext.jsx`. Tests: `preferences.sync.test.js` (8), `PreferenceSync.test.jsx` (5). R4: a theme set on the desktop context appeared on the phone context after a reload in 488–527 ms, reload included (BUILD_REPORT C9). Open sessions are not updated until they reload. |
| FR-34 | Partly met | `S/src/modules/notifications/push/push.js` (channel, payload, pruning), `push.routes.js`, `S/src/db/tx.js` `afterCommit`, `S/migrations/1792200000000_push-subscriptions.js`, `S/scripts/vapid.js`; `C/pwa/push.js`, `C/../public/push-sw.js`, the switch in `UserMenu.jsx`. Tests with a mocked `web-push`: `push.test.js` (21: payload is exactly `{title, link}` with no record text or names, every device, opt-out, inactive users, eligible types, nothing before commit, nothing after a rollback, a failing push service does not fail the submit, 404/410 pruning, failure counting, off by default, production refusal without keys); `PushSwitch.test.jsx` (7), `PushSwitchOff.test.jsx` (1). **Unverified:** delivery through a real browser push service to a real device; push was never turned on against one. |

---

## Status changes since `f810696` (Parts P, Q and R)

| ID | Before | Now | Why |
|---|---|---|---|
| FR-32 | (no requirement) | **Met** | Draft added; installable app, shell-only service worker, phone layout |
| FR-33 | (no requirement) | **Met** | Draft added; theme and email preferences on the server |
| FR-34 | (no requirement) | Partly met | Draft added; push channel tested with a mocked push service, real delivery unverified |

No proposal requirement changed status. Unchanged status, changed evidence: NFR-03 (R4 browser timings),
NFR-08 (deploy guide requires HTTPS; code still plain HTTP), NFR-14 (axe at the phone viewport, all rules,
0 violations; keyboard still untested), NFR-15 (390 px added; still one browser), NFR-18 (Dockerfile,
production start-up checks; still fails on Node 18), IR-01 (tab bar; touch check 15/15 again), IR-05 (push
channel), DR-10 (theme preference and push subscriptions), FR-17 (push and preference audits).

## Status changes since `23097ee`

| ID | Before | Now | Why |
|---|---|---|---|
| FR-14 | Partly met | **Met** | Completion rate and current/preceding-shift window with an "all records" toggle |
| FR-16 | Partly met | **Met** | Shift filter; tests |
| NFR-11 | Partly met | **Met** | Daily scheduled backups (task must be registered once) |
| NFR-17 | Partly met | **Met** | All 20 FRs have tests |
| DR-02 | Partly met | **Met** | One EAT formatter everywhere; EAT input |
| DR-04 | Partly met | **Met** | 10–1,000 characters enforced |
| DR-11 | Partly met | **Met** | Every result now marked synthetic |
| DR-12 | Partly met | **Met** | Rejected writes audited and logged |
| IR-01 | Partly met | **Met** | 44 px targets, measured 15/15 |
| IR-04 | Partly met | **Met** | LIMIT/OFFSET parameterised; 400 not 500 |
| IR-05 | Not met | **Met** | Single notification service; SMTP channel |
| IR-06 | Not met | **Met** | Retries with backoff; outcome on the notification |
| IR-07 | Not met | **Met** | Degraded mode; dashboard flag |

Unchanged status, changed evidence: NFR-05 (approval no longer returns the password; the one reveal
still does), NFR-10 (fault-injection test added), NFR-18 (engines + CI; fails on Node 18), DR-05
(now tested), DR-09 (daily backups; still no WAL), DR-08 and IR-08 (re-judged, unchanged).

---

## Answers to the specific questions (as of `23097ee`)

Answers 1–5 below describe the code before Parts H–K. Where they say something is missing, the rows
above say what changed: DR-02 (answer 1), DR-04 (2), DR-12 (3), IR-01 (4), IR-04 (5).

### 1) DR-02: storage and display of timestamps

**Storage: met.** Every temporal column is `timestamptz`:
`initial-schema.js:21` (`now` helper, used by `handover_record.created_at`, `task.created_at`,
`supervisor_review.reviewed_at`, `notification.sent_at`, `audit_log.logged_at`), `:69-70`
(`shift.start_time/end_time`), `:82-83` (`submitted_at`, `closed_at`), `:109` (`occurred_at`),
`:117` (`confirmed_at`), `:137` (`read_at`); `1791100000000_access-requests.js:26,31`;
`1791300000000_messaging.js:33,51`; `1791400000000_shift-reminders.js:30`; since then also
`email_outbox` and `app_user.calendar_feed_created_at`. Postgres stores `timestamptz` as UTC; the API
returns ISO 8601 UTC strings.

**Display (at `23097ee`): not met.** Most dates used `new Date(d).toLocaleString()` in the browser's
zone and locale; shift times used Nairobi time but not ISO order; the incident input used the
browser's zone. Fixed in `97e0f23` (see DR-02 above).

### 2) DR-04: validation of task and incident fields

At `23097ee` the task description was only "non-empty"; severity and time of occurrence were required.
Fixed in `294307a` (DR-04 above).

### 3) DR-12: logging of rejected submissions

At `23097ee` rejected submissions were rolled back and not logged with their reason. Fixed in `1031979` (DR-12 above).

### 4) IR-01: breakpoints and touch targets

At `23097ee` most targets were 32–36 px. Tailwind v4 default breakpoints (`sm` 640, `md` 768, `lg` 1024,
`xl` 1280); no 320 px breakpoint (mobile-first base). Fixed in `37aa42f` and `e9a0ca1` (IR-01 above).

### 5) IR-04: string-built queries

At `23097ee`, `LIMIT ${size} OFFSET ${offset}` in messages was interpolated and `page=99999999999999999999`
returned 500. Fixed in `d8efc69`. Other template literals put only **fixed SQL text** into queries, never user values:
shared column/join fragments (`RECORD_SELECT`, `PROFILE_SELECT`, `USER_COLUMNS`, `REQUEST_SELECT`, `VISIBLE`,
`messageSelect`, `ASSIGNED`, `SHIFT_COLUMNS`, `DUE_WINDOW`, and since then `CALENDAR_COLUMNS` and the
dashboard's `inWindow(alias)`), `WHERE` lists joined from fixed fragments with `$n` placeholders, and constant
choices (`extraSql`, `FOR UPDATE`, `ASC`/`DESC`).

### 6) NFR-06: fixed or sliding expiry

**Fixed from sign-in** (`expiresIn: process.env.JWT_EXPIRY || '30m'`), for password and Google sign-in alike.
No refresh endpoint; a 401 logs the client out. A password change issues a fresh token.

### 7) NFR-14: axe-core results

axe-core 4.10.0 (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`), headless Edge, 1280 × 900, both themes: **0
colour-contrast violations** on login, outgoing, incoming, supervisor overview and queue, admin users and
templates. Not re-run after Parts H–K. Keyboard-only operation not tested.

### 8) DR-10: personal data beyond the five listed fields

`app_user.password_hash`, `google_sub`, `must_change_password`, `email_notifications`, `calendar_feed_hash`
(SHA-256 of the feed token); `access_request` rows for non-users; message subjects and bodies; per-user
read times; notification text (reminders name colleagues); the roster; free text in records; audit snapshots.
`email_outbox.to_address` repeats a work email already held. No passenger data.

### 9) FR-19: alerts beyond the dashboard flag

The reminders job (now the "jobs tick", `S/src/jobs/reminders.js` `startJobs`) sends in-app reminders and, when
email is on, queues email alerts for them and sends the outbox.

### 10) FR-03: endpoints that cross departments

`GET /api/directory` (every active user), `GET /api/directory/departments`, direct messages to anyone,
broadcasts by supervisors/admins to any department or everyone, unauthenticated department list for the
access-request form. All deliberate. The calendar feed and downloads are not cross-department.

### 11) FR-21..FR-25

No draft wording exists in the repository. FR-24 (Google sign-in) is described in one paragraph in
`README.md` ("How it works, in one paragraph"). Draft FR-32..FR-34 (Parts Q and R) were written for
this pass and are in [their own section](#draft-requirements-fr-32fr-34-not-in-the-proposal).
