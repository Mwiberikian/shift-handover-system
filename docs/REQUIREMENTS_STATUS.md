# Requirements Status — Shift Handover Management System

Date: 2026-10-13. Code state: `23097ee` plus the four test files added for
[TRACEABILITY.md](TRACEABILITY.md). Requirement texts:
[requirements.md](requirements.md), copied word for word from Chapter 4 of the proposal.

Test totals at the time of writing: **server 164/164 (18 suites), client 23/23 (5 files)**.
Figures marked "C1"–"C5" are from [BUILD_REPORT.md](BUILD_REPORT.md).

Status meanings:
- **Met**: a test or a measurement shows it, or the cited code shows it.
- **Partly met**: some of the statement holds and some does not. The row says which.
- **Not met**: the code does not do it.
- **Unverified**: nothing in the repository shows it either way (usually because it needs people, browsers or a deployment).

Paths are relative to the repository root. `S/` = `server/`, `C/` = `client/src/`.

---

## Functional requirements

| ID | Status | Evidence |
|---|---|---|
| FR-01 | Met | `S/src/modules/admin/admin.routes.js:28-56`, `admin.service.js:20-28` (non-admin roles need one department), `:128-132` (delete = deactivate). Tests: `admin.users.test.js` (all 8), `access-request.workflow.test.js` "creates a working login with the role and department the admin assigned", `rbac.test.js` "a token for a deactivated account is rejected immediately". |
| FR-02 | Met | `S/src/modules/auth/auth.service.js:37-49` (staff number or email, bcrypt), `:25-35` (signed JWT). Every role router runs `requireAuth` first (`handovers.routes.js:9`, `admin.routes.js:9`, `shifts.routes.js:8`, `messages.routes.js:13`, `notifications.routes.js:9`, `dashboard.routes.js:12`). Tests: `auth.login.test.js` (all 4), `rbac.test.js` "missing or invalid token is 401", `C/test/Login.test.jsx`. |
| FR-03 | Partly met | Handover data, shifts and dashboard are department-scoped (`S/src/middleware/auth.js:49-54`, `handovers.service.js:144-168`, `workflow.service.js:24-32,271-282`, `shifts.service.js:15,53,67`), tested in `rbac.test.js`, `handover.open-review.test.js`, `handover.export.test.js`, `shift-reminders.test.js` (roster API). **Not met for:** directory, messages and department list. See answer 10. |
| FR-04 | Met | `GET /api/handovers/meta` returns the department's current template (`handovers.service.js:171-182`). Submit checks the template server-side (`:348-365`). Tests: `handover.draft-content.test.js` "returns the current shift, the department's current template…", "after the admin publishes a new version…"; `handover.submit.test.js` (4 rejection tests); `C/test/DraftEditor.test.jsx` (3). |
| FR-05 | Met | `S/src/modules/handovers/handovers.routes.js:60-81`, `task_status_enum` and `priority_enum` (`S/migrations/1790865288764_initial-schema.js:30-31`). Tests: `handover.draft-content.test.js` "stores description, status and priority…", "a draft task can be moved to resolved", "an empty description or a status/priority outside the enum is refused". |
| FR-06 | Met | `handovers.routes.js:83-95`; `incident` columns `initial-schema.js:103-111`. Tests: `handover.draft-content.test.js` "stores title, description, severity, time of occurrence and the reporter", "a missing severity or time of occurrence… is refused". |
| FR-07 | Met | `handovers.service.js:348-365` (422 with `missing_fields`; incoming user always required). Client lists outstanding items (`C/pages/OutgoingPage.jsx:20-42,107`). Tests: `handover.submit.test.js` "an empty draft is rejected with 422 listing each missing field", "a summary shorter than the template minLength…", "validation follows the current template version"; `C/test/DraftEditor.test.jsx`. |
| FR-08 | Met | `handovers.service.js:300-340`, called on submit (`:367-368`). Tests: `handover.carryforward.test.js` (all 5). Note: tasks are carried when the *next* record is submitted, not at the moment the shift closes. |
| FR-09 | Met | Service guard `handovers.service.js:42-49`; DB trigger `initial-schema.js:164-244`. A clarification is a new audit entry, not an edit (`workflow.service.js:169-183`). Tests: `handover.immutability.test.js` (all 11). |
| FR-10 | Met | `handovers.service.js:389-395`. Tests: `handover.submit.test.js` "sets status submitted, audits, and notifies incoming staff + supervisor"; `notifications.unread-count.test.js` "a submit raises the count for the incoming user and supervisor only". |
| FR-11 | Met | `workflow.service.js:49-75`. Tests: `handover.incoming-view.test.js` "the assigned incoming user sees tasks, incidents and carried-forward items", "the incoming list holds only records assigned to the caller". |
| FR-12 | Met | `workflow.service.js:107-137`. Closure requires `acknowledged` (`:205-209`, trigger `initial-schema.js:190-201`). Tests: `handover.acknowledgement.test.js` (all 6). |
| FR-13 | Met | `workflow.service.js:139-183`. Tests: `handover.acknowledgement.test.js` "a queried record cannot be reviewed until clarified and acknowledged"; `notifications.unread-count.test.js` "latest_id changes when a new notification arrives" (query → clarify). |
| FR-14 | Partly met | `workflow.service.js:310-363`, `C/pages/SupervisorPage.jsx`. Status counts and overdue items are shown (tests: `dashboard.supervisor.test.js`, 3). **Not met for:** there is no acknowledgement completion rate, and the counts cover all records, not the current and preceding shifts (`:314-328` has no shift filter). |
| FR-15 | Met | `workflow.service.js:205-262` (decision, `supervisor_id`, comments). Tests: `handover.acknowledgement.test.js` "acknowledge -> approve closes the record and records who did what", "escalated records close only through /resolve"; `handover.open-review.test.js` "an under-review record can be %s by the supervisor". |
| FR-16 | Partly met | `handovers.routes.js:28-39`, `workflow.service.js:284-308`: date range, department, status and keyword filters. **No shift filter. No test.** |
| FR-17 | Partly met | `S/src/utils/audit.js:4-14`, called inside the same transaction for every create, update, submit, acknowledge, query, clarify, open-review, review, resolve, login, admin and roster change. Tests: `handover.submit.test.js` "every state-changing call leaves a matching audit_log row", `admin.users.test.js`, `access-request.workflow.test.js`. **Not audited:** system-generated notification rows (`handovers.service.js:96-105`, `jobs/reminders.js:43-55`), and marking a message or notification read (`messages.service.js:98-114`, `notifications.routes.js:42-50`). |
| FR-18 | Met | `admin.service.js:178-219` (insert version N+1, never update). Trigger `initial-schema.js:258-260`. Tests: `admin.templates.test.js` (all 3). |
| FR-19 | Met | `S/src/jobs/reminders.js:117-136` (in-app alert to the department's supervisors, `REMINDER_UNACK_ALERT_MINUTES`, default 120). Dashboard flag `workflow.service.js:330-342`. Tests: `shift-reminders.test.js` "unacknowledged 2 hours after the incoming shift starts: supervisors of that department, once", "no unacknowledged alert once acknowledged", "the supervisor dashboard flags the same condition…". In-app only (see answer 9). |
| FR-20 | Met | `workflow.service.js:77-105`, `handovers.routes.js:115-122` (JSON, `?download=1`), `C/pages/PrintRecord.jsx` (print view). Tests: `handover.export.test.js` (12, including "outA gets 200…" and "incA gets 200…"), `C/test/PrintRecord.test.jsx` (2). Not printed from a real browser. Export follows the read rules, so the record's outgoing and incoming users can export too, not only supervisors and admins. |

## Non-functional requirements

| ID | Status | Evidence |
|---|---|---|
| NFR-01 | Partly met | API only: `GET /api/handovers` at 60 connections, p97.5 839 ms, p99 890 ms (C2). Page rendering in a browser under load was not measured. |
| NFR-02 | Met | `POST /submit` at 60 connections: p99 462 ms, 0 errors (C2). Localhost, not "standard broadband". |
| NFR-03 | Met | Notification row commits with the submit. Fast poll 20/20 ≤ 108 ms; client-like 5 s poll 30/30 ≤ 4,945 ms (C3). Polling script, not a real browser. A hidden tab updates only when it is shown again (`C/lib/usePolling.js:28`). |
| NFR-04 | Unverified | No run compared view times at 60 sessions against a baseline. |
| NFR-05 | Partly met | bcrypt cost 12 (`S/src/config/constants.js:3`, test `auth.login.test.js` "passwords are stored as bcrypt hashes with work factor 12"). The hash is removed from responses and audit rows (`auth.service.js:19-21`, `admin.service.js:13`). morgan logs method, URL and status only, never request bodies (`app.js:12`). **Exception:** approving an access request returns the generated temporary password in the response (`accessRequests.service.js:94`). |
| NFR-06 | Met | Expiry is **fixed at 30 minutes from sign-in**, not sliding (answer 6). A session therefore always ends ≤ 30 min after its last activity. Test: `auth.login.test.js` "login by staff_number returns a 30-minute JWT…" (`exp - iat = 1800`). Configurable through `JWT_EXPIRY` (`auth.service.js:29`). |
| NFR-07 | Partly met | Every boundary scenario that is tested is refused: `rbac.test.js` (10), `handover.open-review.test.js` (cross-department and role 403s), `handover.export.test.js` "outB/incB/supB gets 403…", `access-request.workflow.test.js` "every non-admin role gets 403…", `shift-reminders.test.js` roster API, `admin.users.test.js` "only admins may create accounts". The cross-department exceptions in answer 10 are allowed by design. |
| NFR-08 | Not met | The API listens on plain HTTP (`S/src/server.js:6`). The dev client uses `http://localhost:4000/api`. There is no TLS configuration in the repository. |
| NFR-09 | Met | No delete or edit route for records or audit rows. Triggers: `initial-schema.js:164-261`. Tests: `handover.immutability.test.js` (all 11). |
| NFR-10 | Met | Submit runs in one `withTransaction` (`handovers.service.js:342-398`, `S/src/db/tx.js:5-18`). Test: `handover.submit.test.js` "a rejected submit writes no audit row and no notifications". No fault-injection test (for example, killing the connection mid-submit). |
| NFR-11 | Partly met | Restore of a 30,001-record database in 3.4 s wall time, row counts matched (C4). Backups are manual (`scripts/backup.ps1`). Nothing schedules them, so the 24-hour loss bound depends on someone running the script. |
| NFR-12 | Unverified | No usability walkthrough. |
| NFR-13 | Unverified | No SUS questionnaire. |
| NFR-14 | Partly met | axe-core 4.10: **0 colour-contrast violations** on 7 views × 2 themes (answer 7). Keyboard-only operation was not tested. |
| NFR-15 | Unverified | Only headless Edge (axe run) and jsdom were used. Chrome, Firefox and Safari were not tested, nor were widths of 320–1920 px. |
| NFR-16 | Met | Separate `client/`, `server/` and Postgres container (`docker-compose.yml`). Backend statement coverage is 86.61 % (files loaded by tests) and 77.85 % (all of `server/src`) (C1, measured at 143 tests). |
| NFR-17 | Partly met | [TRACEABILITY.md](TRACEABILITY.md) maps 19 of 20 FRs to tests. FR-16 has no test. |
| NFR-18 | Partly met | Configuration comes from environment variables (`S/.env.example`, `C/.env.example`). Only Node 24 and PostgreSQL 15 were run. No `engines` field. Not tested on Node 18. |
| NFR-19 | Met | `workflow.service.js:205-262`, trigger `initial-schema.js:190-201`. Tests: `handover.acknowledgement.test.js` "supervisor review of an unacknowledged record is rejected (409)", "the DB refuses to close a record that was never acknowledged". |

## Data requirements

| ID | Status | Evidence |
|---|---|---|
| DR-01 | Met | `handover_record.summary_notes`, `task`, `incident` (`initial-schema.js:74-111`). Pending items are tasks in `open`/`in_progress`. |
| DR-02 | Partly met | Storage met, presentation not met (answer 1). |
| DR-03 | Met | `initial-schema.js:26-33` (`role_enum`, `record_status_enum`, `task_status_enum`, `priority_enum`, `severity_enum`), used at `:60,80,97-98,108`. |
| DR-04 | Partly met | Severity and time of occurrence are required (answer 2; tested). **The 10–1,000 character task description rule is not enforced anywhere.** |
| DR-05 | Met | Partial unique index `handover_record_one_open_per_shift` (`initial-schema.js:86-91`), mapped to 409 (`handovers.service.js:199-201`). No test creates a second open record. |
| DR-06 | Met | Every FK is `ON DELETE RESTRICT` (`initial-schema.js:19`, `1791100000000_access-requests.js:12`, `1791300000000_messaging.js:20`, `1791400000000_shift-reminders.js:17`). |
| DR-07 | Partly met | The creator (`outgoing_user_id`), acknowledger (`acknowledgement.incoming_user_id`) and reviewer (`supervisor_review.supervisor_id`) are kept. The audit log stores previous and new values for user actions (FR-17). It does not store them for read receipts or system-created notifications. |
| DR-08 | Partly met | No hard-delete path (NFR-09). **No 24-month archival job exists.** |
| DR-09 | Partly met | A manual logical backup script exists and restore is tested (C4). **Nothing runs it daily. There is no WAL archiving** (`docker-compose.yml` sets no `archive_mode`). |
| DR-10 | Partly met | No passenger data. More personal data is held than the five listed fields (answer 8). |
| DR-11 | Partly met | Seeds are labelled synthetic (`S/src/db/seeds/seed.js:4-6`, `README.md:4`, `SYNTHETIC:` prefixes). BUILD_REPORT's results do not state that the data was synthetic. |
| DR-12 | Partly met | Validation happens at the API (`S/src/middleware/validate.js:6-10`, `handovers.service.js:348-365`). **Rejected submissions are not logged with their reason** (answer 3). |

## Interface and integration requirements

| ID | Status | Evidence |
|---|---|---|
| IR-01 | Partly met | Responsive SPA with a 768 px (`md`) and 1280 px (`xl`) breakpoint. There is no 320 px breakpoint (mobile-first base). **Most touch targets are 32–36 px, not 44 px** (answer 4). |
| IR-02 | Partly met | REST + JSON with 400/401/403/404/409/422/500 (`errorHandler.js:5-22`, `validate.js:8`, `auth.js:11,18,41`). Plain HTTP, not HTTPS (NFR-08). |
| IR-03 | Met | `Authorization: Bearer` (`S/src/middleware/auth.js:9-19`). Claims are `user_id`, `role`, `department_id` and `exp` (`auth.service.js:26-30`). Test: `auth.login.test.js` "login by staff_number returns a 30-minute JWT with user_id, role, department_id". |
| IR-04 | Partly met | Pooled `pg` (`S/src/config/db.js:3-5`). All values are bound as `$n`, **except `LIMIT`/`OFFSET` in messages** (answer 5). |
| IR-05 | Not met | No SMTP gateway and no single notification service. Each caller inserts into `notification` itself (`handovers.service.js:96-105`, `messages.service.js:159-164`, `jobs/reminders.js:43-55`). |
| IR-06 | Not met | No outbound email, retries or backoff. |
| IR-07 | Not met | No email channel, so there is no undelivered-alert flag. The in-app notification and the `submitted` state do hold (FR-10). |
| IR-08 | Partly met | Stable `/api` prefix (`S/src/app.js:14-28`). It has no version segment such as `/api/v1`. |
| IR-09 | Met | `auth.service.js` holds the local credential check. Google sign-in reuses the same session issuer (`:25-35`, `:102-141`). `requireAuth` depends only on the JWT (`middleware/auth.js:8-34`). |

---

## Answers to the specific questions

### 1) DR-02: storage and display of timestamps

**Storage: met.** Every temporal column is `timestamptz`:
`initial-schema.js:21` (`now` helper, used by `handover_record.created_at`, `task.created_at`,
`supervisor_review.reviewed_at`, `notification.sent_at`, `audit_log.logged_at`), `:69-70`
(`shift.start_time/end_time`), `:82-83` (`submitted_at`, `closed_at`), `:109` (`occurred_at`),
`:117` (`confirmed_at`), `:137` (`read_at`); `1791100000000_access-requests.js:26,31`;
`1791300000000_messaging.js:33,51`; `1791400000000_shift-reminders.js:30`. Postgres stores
`timestamptz` as UTC, and the container's `TimeZone` is `Etc/UTC`. The API returns them as ISO 8601 UTC
strings (JSON serialisation of `Date`). The export sets `exported_at` with `toISOString()`
(`workflow.service.js:100`).

**Display: not met.**
- Most dates use `fmt` = `new Date(d).toLocaleString()` (`C/lib/format.js:3`), with `fmtDate`/`fmtTime` at
  `:5,7`. These use the **browser's** time zone and locale, so they show EAT only when the computer is set
  to Nairobi. The output is not ISO 8601 (for example "13/10/2026, 18:00:00" in an en-GB browser). `fmt` is used for
  record, incident, audit, review and message times: `C/components/Handover.jsx:28,36,104,137,177,189,191`,
  `C/pages/PrintRecord.jsx:84-89,111,119,129,137`, `C/pages/OutgoingPage.jsx:329,364-365`,
  `C/pages/IncomingPage.jsx:112`, `C/pages/SupervisorPage.jsx:119,332`, `C/pages/MessagesPage.jsx:51,185`,
  `C/pages/AccessRequests.jsx:173,202`.
- Shift times use `Africa/Nairobi` explicitly (`C/lib/format.js:39-43`, used in `ShiftBanner.jsx:30,48` and
  `RosterPage.jsx:44,99,126`). Reminder text does the same (`S/src/jobs/reminders.js:31-33`). The format is
  `HH:MM EAT` / "Tue 13 Oct", which is EAT but not ISO 8601.
- The incident "Occurred at" input is `datetime-local` (`OutgoingPage.jsx:253`). It is converted with
  `new Date(value).toISOString()` (`:128`), so the browser's time zone, not EAT, decides what it means.

### 2) DR-04: validation of task and incident fields

- **Task description:** only "string, non-empty after trim" (`handovers.routes.js:64` on create, `:76` on
  update). The column is unbounded `text` (`initial-schema.js:96`). The client input has no length limit
  (`OutgoingPage.jsx:233-235`). **No minimum of 10 or maximum of 1,000 characters exists.**
- **Incident severity:** required, one of `low|medium|high|critical` (`handovers.routes.js:91`). The DB column
  is `severity_enum NOT NULL` (`initial-schema.js:108`).
- **Incident time of occurrence:** required ISO 8601 (`handovers.routes.js:92`), `timestamptz NOT NULL`
  (`initial-schema.js:109`). There is no check that it is not in the future or that it falls within the shift.
- Tests (new): `handover.draft-content.test.js` "a missing severity or time of occurrence, or an unknown
  severity, is refused (400)".

### 3) DR-12: logging of rejected submissions

**No.** A validation failure throws `AppError(400)` (`S/src/middleware/validate.js:8`). An incomplete submit
throws `AppError(422)` with `missing_fields` (`handovers.service.js:361-365`). The error handler sends the
response and logs nothing for an `AppError` (`errorHandler.js:6-8`); only unexpected errors are logged (`:20`). The
422 is raised inside the submit transaction, which is rolled back. The test `handover.submit.test.js` "a
rejected submit writes no audit row and no notifications" asserts that nothing is written. The only trace
is morgan's request line (method, URL, status), and only when `NODE_ENV` is not `test` (`app.js:12`).
It does not record the reason or the user.

### 4) IR-01: breakpoints and touch targets

- **Breakpoints:** Tailwind v4 defaults. `C/index.css:11-79` defines no custom `--breakpoint-*`, so
  `sm` = 640, `md` = 768, `lg` = 1024, `xl` = 1280 px. Usage in `.jsx`: `sm:` 116, `lg:` 54, `md:` 13,
  `xl:` 5, `max-sm:` 2, and one `min-[400px]:`. The table hides columns by `hideBelow` (`C/components/ui/Table.jsx:5`).
  There is no 320 px breakpoint (unprefixed styles apply from 0 px). 768 and 1280 exist, but the layout mostly
  switches at 640 and 1024.
- **Touch targets:** `C/components/ui/Button.jsx:14-19`: `sm` = `h-8` (32 px), `md` = `h-9` (36 px, the default),
  `icon` = `size-9` (36 × 36 px), `lg` = `h-11` (44 px). Inputs and selects are `h-9` (36 px) (`C/components/ui/Field.jsx:47,66`).
  Only `lg` buttons reach 44 px.

### 5) IR-04: string-built queries

**Values from users are bound as `$n` parameters everywhere except one place.**
`messages.service.js:51` and `:68` interpolate `LIMIT ${size} OFFSET ${offset}`. These values come from `?page` and
`?page_size`. They pass `isInt({min:1})` (`messages.routes.js:15-18`) and `Number()`/`Math.min/max` (`messages.service.js:35-39`),
so they are always numbers and cannot inject SQL. They are still not parameters, and a very large page fails: `GET /api/messages/inbox?page=99999999999999999999`
returned **500** (`bigint out of range`) on the scratch instance.

Other template literals put only **fixed SQL text** into queries, never user values:
- shared column and join fragments: `RECORD_SELECT` (`handovers.service.js:8-16`), `PROFILE_SELECT` (`auth.service.js:14-17`),
  `USER_COLUMNS` (`admin.service.js:9-10`), `REQUEST_SELECT` (`accessRequests.service.js:8-14`), `VISIBLE` and `messageSelect` (`messages.service.js:18-33`),
  `ASSIGNED` (`shifts.service.js:7-10`), `SHIFT_COLUMNS` and `DUE_WINDOW(anchor, sign)` with constant arguments (`reminders.js:37-41`).
- `WHERE` built by joining fixed fragments that hold `$n` placeholders (`handovers.service.js:147,163`, `workflow.service.js:290,303`).
  The search keyword is bound as a parameter after escaping `%`/`_` (`workflow.service.js:296-300`).
- constant choices: `extraSql` is either `''` or `', closed_at = now()'` (`workflow.service.js:43`, callers `:217,250`).
  Also `lock ? 'FOR UPDATE' : ''` (`admin.service.js:147`, `shifts.service.js:31`), and `ASC`/`DESC` chosen from a validated enum (`accessRequests.service.js:52`).

No query uses `+` concatenation. Strictly, the requirement's "no query constructed by string concatenation" is
not met, because queries are assembled from fragments, but none of those fragments contains user input.

**Files checked** (every file that issues SQL): `server/src/config/db.js`, `server/src/db/tx.js`,
`server/src/utils/audit.js`, `server/src/middleware/auth.js`, `server/src/jobs/reminders.js`,
`server/src/modules/auth/auth.routes.js`, `auth.service.js`, `server/src/modules/health/health.routes.js`,
`server/src/modules/handovers/handovers.service.js`, `workflow.service.js`, `server/src/modules/messages/messages.service.js`,
`server/src/modules/notifications/notifications.routes.js`, `server/src/modules/shifts/shifts.service.js`,
`server/src/modules/admin/admin.service.js`, `server/src/modules/accessRequests/accessRequests.service.js`,
`server/src/db/seeds/seed.js`, `server/src/db/seeds/demo-reminders.js`, all five `server/migrations/*.js`,
`server/tests/helpers/globalSetup.js` (test-only `CREATE DATABASE "${dbName}"` from the env URL), and
`scripts/restore.ps1` (fixed count query). Route files that only call services were also read:
`handovers.routes.js`, `messages.routes.js`, `shifts.routes.js`, `admin.routes.js`, `dashboard.routes.js`,
`accessRequests.routes.js`.

### 6) NFR-06: fixed or sliding expiry

**Fixed from sign-in.** The token is signed once with `expiresIn: process.env.JWT_EXPIRY || '30m'`
(`auth.service.js:26-30`), and that applies to Google sign-in too (`:140`). There is no refresh or re-issue endpoint
(`auth.routes.js` has only `login`, `google*` and `me`). `requireAuth` only verifies the token (`middleware/auth.js:16`).
In the client, a 401 clears the token and logs the user out (`C/api.js:22-31`), and an expired token found at load is dropped
(`C/auth/AuthContext.jsx:13-21`). A user who is active for 30 minutes is therefore signed out mid-work.
This is stricter than the requirement, not looser.

### 7) NFR-14: axe-core results (report only, nothing fixed)

Tool: axe-core 4.10.0, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Headless Microsoft Edge (Playwright),
1280 × 900, reduced motion, theme forced through the app's own `shms-theme` setting. The `.dark` class on `<html>` was confirmed for
each dark run. Two passes were made:
- **Dev instance** (your running client on 5173 and API on 4000, `shms_dev`): login, outgoing, incoming, supervisor and admin.
  On this database `/outgoing` showed only the "No active shift" empty state.
- **Scratch instance** (client on 5174, API on 4100, seeded `shms_eval_scratch` with a draft containing a task and an incident, plus a
  submitted Maintenance record): login, outgoing (full draft editor), incoming (pending record open), supervisor
  overview, supervisor queue, admin users and admin templates.

| Page | Light: contrast violations | Dark: contrast violations | Undecided by axe | Other WCAG violations |
|---|---|---|---|---|
| Login | 0 | 0 | 9 per theme (text on the frosted card over the photo, `bgGradient`) | 0 |
| Outgoing (draft editor) | 0 | 0 | 2 per theme (two textareas, `elmPartiallyObscured`) | 0 |
| Incoming (record open) | 0 | 0 | 0 | 0 |
| Supervisor overview | 0 | 0 | 0 | 0 |
| Supervisor queue | 0 | 0 | 0 | 0 |
| Admin users | 0 | 0 | 0 | 0 |
| Admin templates | 0 | 0 | 0 | 0 |

**axe reported no contrast violations in either theme.** Things axe does not cover, checked by hand:
- Placeholder text (`placeholder:text-ink-500`, `Field.jsx:5`): 4.83:1 in light, 5.59:1 in dark. Passes.
- The 9 undecided login nodes sit on the frosted card over a photo. They need a manual check against the real
  image. The card fill is 80 % opaque (`index.css:126-141`).
- Initials of an *inactive* user in the admin list use `text-ink-400` on `bg-ink-50` (`AdminPage.jsx:144`), about 2.5:1.
  They are `aria-hidden`, the name is shown beside them, and no inactive user existed in either database, so axe did not see them.

Not covered: keyboard-only operation (the other half of NFR-14), any view other than the ones listed, dialogs and
drawers in their open state, mobile widths.

### 8) DR-10: personal data beyond the five listed fields

| Where | Field | Note |
|---|---|---|
| `app_user` | `password_hash` | Needed for sign-in (`initial-schema.js:59`). |
| `app_user` | `google_sub` | Google account identifier, stored after the first Google sign-in (`1791200000000_app-user-google-sub.js:14-16`). |
| `access_request` | `full_name`, `email`, `staff_number`, `note`, `review_reason`, `created_at` | Held for people who are **not** users, including rejected requesters. Kept indefinitely (`1791100000000_access-requests.js:17-32`). |
| `message` | `subject`, `body` | Free text up to 2,000 characters. Append-only, so it can never be removed (`1791300000000_messaging.js:25-34,56-63`). |
| `message_read` | `user_id`, `read_at` | Per-user read times (`:48-52`). |
| `notification` | `title`, `body`, `read_at` | Reminder text includes colleagues' names (`1791400000000_shift-reminders.js:34-39`, `reminders.js:113,134`). |
| `shift_assignment` | who works which shift | Roster (`1791400000000_shift-reminders.js:20-23`). |
| `incident` / `task` / `summary_notes` | free text | May name people. |
| `audit_log` | `previous_value`, `new_value` (jsonb) | Full user snapshots (name, email, role, `google_sub`, but not the hash: `admin.service.js:13`), full access-request rows including `note` (`accessRequests.service.js:41-43,90-93`), the `google_sub` link (`auth.service.js:131-134`), and a `login` row for every sign-in. Append-only, so it can never be removed (`initial-schema.js:255-257`). Message subjects and bodies are kept out of it (`messages.service.js:149-156`). |

No passenger data is held. Request logs (morgan `dev`) contain no IP address or body.

### 9) FR-19: alerts beyond the dashboard flag

Yes. `S/src/jobs/reminders.js` runs every minute (`:168-183`). It is started from `S/src/server.js:13-16` unless
`NODE_ENV=test` or `REMINDERS_ENABLED=false`. Every alert is an **in-app `notification` row** of type
`reminder`. No email or SMS is sent. Each alert is written once per (type, reference, user), guarded by
`reminder_log` (`:43-55`), and only if its due time is in the last 60 minutes (`REMINDER_LOOKBACK_MINUTES`,
`:27,36-39`).

| Type | To | When (defaults, env-configurable at `:20-29`) | Condition |
|---|---|---|---|
| `shift_start` | staff assigned to the shift | 30 min before shift start | active user (`:59-75`) |
| `handover_due_first` | assigned **outgoing** staff | 30 min before shift end | no non-draft record for the shift (`:79-95`) |
| `handover_due_final` | assigned outgoing staff | 10 min before shift end | same |
| `ack_pending` | the record's incoming user | 15 min after the incoming shift starts (= record's shift `end_time`) | status `submitted` (`:99-115`) |
| `supervisor_unacknowledged` | every active supervisor of the department | 120 min after the incoming shift starts | status `submitted` or `queried` (`:117-136`) |
| `supervisor_no_handover` | every active supervisor of the department | at shift end | no non-draft record for the shift (`:139-154`) |

In the client, the bell polls every 5 s. When a new `reminder` arrives it shows a toast, and it shows a browser desktop
notification if the user has turned that on (`C/components/shell/NotificationsMenu.jsx:92-99`, `C/lib/desktopAlerts.js:32-40`).
Admins get no reminders. If a department has no supervisor, nobody gets the alert.

### 10) FR-03: endpoints that cross departments

| Endpoint | What crosses | Evidence |
|---|---|---|
| `GET /api/directory` | Every active user in every department (name, role, department). Any authenticated role can call it. | `messages.routes.js:61-63`, `messages.service.js:170-178`; test `messaging.test.js` "directory lists active users with minimal fields only" |
| `GET /api/directory/departments` | All department ids and names | `messages.routes.js:64`, `messages.service.js:181-184` |
| `POST /api/messages` (`recipient_type: user`) | Any user may message any active user in any department (deliberate, documented) | `messages.service.js:6-9,116-121`; test "work across departments, notify the recipient…" |
| `POST /api/messages` (`department`) | Supervisors and admins may broadcast to **any** department | `messages.service.js:123-129`; test "supervisors and admins can broadcast to any department" |
| `POST /api/messages` (`organisation`) | Supervisors and admins reach every user | `messages.service.js:131-133` |
| `GET /api/messages/inbox`, `/:id` | Readers see messages from senders in other departments, with sender name and department | `messages.service.js:18-33` |
| `GET /api/access-requests/departments` | Department codes and names, **unauthenticated** | `accessRequests.routes.js:24`; test "lists departments publicly with code and name only" |
| `/api/admin/*`, `GET /api/dashboard/supervisor`, `GET /api/handovers/search`, `GET /api/shifts` | Admin only, or admin may pass any department | Intended for the admin role |

No cross-department path was found for handover records, tasks, incidents, notifications, roster changes or
shift assignments. `GET /api/shifts` and `GET /api/shifts/:id/assignments` are scoped (`shifts.service.js:15,53,67`).
`GET /api/shifts/mine` returns only the caller's shifts (`:90-106`).

### 11) FR-21..FR-25

**Not possible.** No draft wording for FR-21..FR-25 exists. It was not in `docs/requirements.md` (which did not exist
before this change), not in the proposal (which defines FR-01..FR-20 only), and nowhere else in the repository.
`docs/requirements.md` now says so at the bottom. No corrections were made. Send the drafts and I will correct them
against the code.

---

## What is not covered anywhere

- Nothing was run in Chrome, Firefox or Safari, on a phone, or at widths other than 1280 px. The print view was not printed from a browser.
- No usability walkthrough or SUS (NFR-12, NFR-13). No keyboard-only test (NFR-14).
- No TLS (NFR-08, IR-02) and no email channel (IR-05..IR-07).
- No fault-injection test for the submit transaction (NFR-10).
- No 60-session degradation comparison (NFR-04). Page render time under load was not measured (NFR-01).
- No scheduled backups, WAL archiving or 24-month archival (DR-08, DR-09, NFR-11).
- No test for search (FR-16) or for the one-open-record constraint (DR-05).
- All load figures come from one machine, with the load generator on the same host (C2, C5).
