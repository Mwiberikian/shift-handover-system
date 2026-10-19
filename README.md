# Shift Handover Management System (SHMS)

Final-year project prototype: digital shift handovers with acknowledgement,
supervisor review and a tamper-proof audit trail. **All seeded data is synthetic.**

Stack: React 18 (Vite, Tailwind CSS v4) · Node.js/Express · PostgreSQL 15 · JWT ·
node-pg-migrate · node-cron. Needs **Node.js 22 or later** (both `package.json`
files say so; CI runs Node 22 and 24).

## Run locally

```bash
docker compose up -d                 # Postgres 15 on :5432

cd server
cp .env.example .env                 # then set JWT_SECRET
npm install
npm run migrate up
npm run seed                         # wipes and reseeds dev data
npm run dev                          # API on http://localhost:4000 (+ reminder scheduler)
npm run demo:reminders               # optional: a shift ending in ~35 min to watch reminders

cd ../client
cp .env.example .env
npm install
npm run dev                          # UI on http://localhost:5173
```

Seeded logins (57 synthetic accounts, all with password `Password123!`):

| Department | Outgoing (6) | Incoming (6) | Supervisors (2) |
|---|---|---|---|
| Ground Operations (`ground_ops`) | KQ1001, KQ1011–KQ1015 | KQ1002, KQ1021–KQ1025 | KQ1003, KQ1004 |
| Aircraft Maintenance (`maint`) | KQ2001, KQ2011–KQ2015 | KQ2002, KQ2021–KQ2025 | KQ2003, KQ2004 |
| Customer Service (`cust_svc`) | KQ3001, KQ3011–KQ3015 | KQ3002, KQ3021–KQ3025 | KQ3003, KQ3004 |
| Flight Operations (`flight_ops`) | KQ4001, KQ4011–KQ4015 | KQ4002, KQ4021–KQ4025 | KQ4003, KQ4004 |
| Admin | KQ9001 | | |

The first account in each column (KQd001, KQd002, KQd003, KQ9001) is the
original demo login and is unchanged. The seed wipes the database and rebuilds
the same data set every time it runs:

- Shifts for every department from 06:00 Nairobi time seven days ago to the
  next shift, with three outgoing and three incoming staff on each. KQd001
  works the current shift and KQd002 the next one.
- For every past shift: an acknowledged handover record with two tasks, a work
  session for each rostered worker, two task timers, and the outgoing author's
  submitted shift report shared with the department's first supervisor (with
  its notification).
- Ground Ops' previous-shift record has an open task, so submitting the current
  Ground Ops handover demonstrates carry-forward.
- Two workers per department are on shift now (KQd011 and KQd023). Unless a
  client sends heartbeats, the session job ends their sessions 10 minutes later.

All seeded free text starts with `SYNTHETIC`.

## Features at a glance

- Structured handovers per department template, carry-forward of open tasks,
  acknowledgement or query, supervisor review/escalation, append-only audit log.
- Request access (public form; an admin approves and assigns the role). The
  approving admin sees the generated temporary password once, in the approval
  dialog; it is never stored, logged or emailed, and the approve response itself
  does not contain it. The new user must choose their own password at first
  sign-in (`POST /api/auth/change-password`); until then the API refuses every
  other call. The one-time copy is held in the API's memory for 10 minutes, so a
  restart in that window loses it: set a new password from Users instead.
- Optional Sign in with Google for existing accounts (see below).
- In-app messaging, shift reminders, a supervisor roster.
- The notification bell and message badge poll an unread count every 5 s
  (NFR-03) and pause while the browser tab is hidden.
- Record export (FR-20): `GET /api/handovers/:id/export` returns the record with
  tasks, incidents, acknowledgement, reviews and audit entries as JSON; every
  record view has a **Print / export** button that opens a print-friendly page.
- Light and dark themes (follows the OS until the user picks one), a help
  centre at `/help`, and a support contact bar driven by `client/.env`.
- **Shift reports** (`/reports`): a worker's own account of a shift, prefilled
  from their work session (tasks resolved as done, open and in-progress tasks as
  pending), submitted once and then unchangeable. Shared with colleagues in the
  department or supervisors (supervisors and admins: anyone active), with an
  optional email alert that carries the title and a link only. Downloaded as a
  PDF, or by supervisors and admins as CSV (formula cells neutralised, 5,000-row
  cap, 20 downloads an hour). Every create, change, submit, share, read and
  download is audited.
- **Work sessions and task timers** (`/work`, header clock): Start shift and End
  shift, a timer per task on the draft handover, a heartbeat every 60 s while
  the app is on screen. Workers are told, on first use and in Help: "Your session
  and task times are visible to your supervisor. Nothing else on your device is
  tracked."
- **Supervisor live board** (`/supervisor/live`, `/admin/live`): who is rostered
  on the shift that is on now, working, idle, not started, ended or handover
  submitted, with session and task timers, task and incident counts, last
  activity and a per-worker timeline; polls every 5 s.

What each of these does and does not do: [docs/FEATURES_ADDED.md](docs/FEATURES_ADDED.md).

## Environment variables

`server/.env` (see `server/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `TEST_DATABASE_URL` | `DATABASE_URL` with db `shms_test` | Test database (name must end in `_test`) |
| `JWT_SECRET` | — | Signs session tokens |
| `JWT_EXPIRY` | `30m` | Session length |
| `CLIENT_ORIGIN` | — | Allowed CORS origin (the UI) |
| `PORT` | `4000` | API port |
| `GOOGLE_CLIENT_ID` | unset | Enables Sign in with Google; unset = disabled (config gives `client_id: null`, sign-in endpoints 503) |
| `ACCESS_REQUEST_RATE_LIMIT` | `5` | Public access requests per IP per hour |
| `MESSAGE_RATE_LIMIT` | `30` | Messages per user per hour |
| `REMINDERS_ENABLED` | `true` | `false` turns the reminder scheduler off |
| `REMINDER_SHIFT_START_MINUTES` | `30` | Shift-starting reminder lead time |
| `REMINDER_HANDOVER_DUE_FIRST_MINUTES` | `30` | First handover-due reminder before shift end |
| `REMINDER_HANDOVER_DUE_FINAL_MINUTES` | `10` | Final handover-due reminder before shift end |
| `REMINDER_ACK_PENDING_MINUTES` | `15` | After the incoming shift starts |
| `REMINDER_UNACK_ALERT_MINUTES` | `120` | Supervisor alert after the incoming shift starts |
| `REMINDER_LOOKBACK_MINUTES` | `60` | Missed reminders older than this are not replayed |

`client/.env` (see `client/.env.example`):

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL |
| `VITE_SUPPORT_EMAIL` | Support email in the utility bar and help page; blank = hidden |
| `VITE_SUPPORT_PHONE` | Support phone in the utility bar and help page; blank = hidden |

## Messaging

In-app messages between staff, separate from handover records. The rules are
deliberate:

| Kind | Who can send | Who receives |
|---|---|---|
| Direct | Any active user | One other active user, **in any department** |
| Department broadcast | Anyone, to their **own** department; supervisors and admins, to **any** department | Everyone in that department |
| Organisation-wide | Supervisors and admins only | Every user |

- Cross-department direct messages are intentional: handover coordination
  (e.g. maintenance telling ground operations a tug is back in service) crosses
  departments. This applies to messaging only; **handover data stays
  department-scoped under FR-03**.
- Messages are **append-only**: there are no edit or delete routes, and a
  database trigger rejects `UPDATE`/`DELETE` on `message` and `message_read`.
- Read state is per user (`message_read`), so a broadcast tracks each reader.
  Direct messages also create a bell notification (type `message`); broadcasts
  don't fan out notification rows and are surfaced by the unread count.
- Sending is limited to 30 messages per user per hour (`MESSAGE_RATE_LIMIT`).
- Each send writes an audit row with ids and recipient type, never the body.
- Bodies are plain text (1–2000 characters) and are never rendered as HTML.
- **Send as** (supervisors and admins): *System notification* (the default
  above), *Email* (an email alert; the bell row that tracks it starts read, and
  turns unread if no email can be sent or the email finally fails) or *Both*
  (bell and email for every recipient). The email says only that a message
  arrived and links to the app; the subject and text are never emailed.
  Recipients who turned email alerts off get no email. Email sends are limited
  separately to 10 per user per hour (`MESSAGE_EMAIL_RATE_LIMIT`). See
  [docs/FEATURES_ADDED.md](docs/FEATURES_ADDED.md).

## Shift reminders

A scheduler (`server/src/jobs/reminders.js`, node-cron, every minute) runs with
the API (not under tests) and writes reminders to the notification bell
(type `reminder`). Times in reminders are Nairobi time (DR-02).

| Reminder | To | When |
|---|---|---|
| Shift starting | Staff assigned to the shift | 30 min before it starts |
| Handover due | Assigned outgoing staff | 30 and 10 min before shift end, only while nothing has been submitted |
| Acknowledgement pending | The record's incoming user | 15 min after the incoming shift starts, if still `submitted` |
| Not acknowledged (FR-19) | Supervisors of the department | Once, 2 h after the incoming shift starts, if still unacknowledged |
| No handover | Supervisors of the department | Once, when a shift ends with no submitted handover |

- A record belongs to the outgoing shift, so the **incoming shift starts at
  that shift's end**. The supervisor dashboard's "unacknowledged > 2 h" flag
  uses the same rule, so the bell and the dashboard always agree.
- Each reminder is logged in `reminder_log`, unique on
  (type, record or shift, user), and is only sent if that insert succeeds:
  restarts and overlapping ticks can never send it twice. Reminders more than
  `REMINDER_LOOKBACK_MINUTES` (60) overdue are not replayed after downtime.
- Lead times are configurable (`REMINDER_*_MINUTES`, see `server/.env.example`).
- Supervisors manage who works each shift on the **Roster** screen
  (`GET/PUT /api/shifts/:id/assignments`, audited). The seed assigns each
  department's outgoing user to the current shift and incoming user to the next.
- Outgoing and incoming dashboards show a banner for the user's current or next
  shift. Users can opt in to desktop (browser) alerts from the bell; permission
  is only requested when they click "Enable desktop alerts".

To watch reminders fire, with the API running:

```bash
cd server && npm run demo:reminders
```

This adds a Ground Operations shift ending in about 35 minutes with KQ1001 and
KQ1002 assigned (plus the following shift for KQ1002) and prints when each
reminder is expected.

## Sign in with Google (optional)

Google sign-in is off unless `GOOGLE_CLIENT_ID` is set in `server/.env` (an
OAuth 2.0 *Web application* client ID from Google Cloud Console, with
`http://localhost:5173` as an authorised JavaScript origin). When it is unset
`GET /api/auth/google/config` answers `{ "client_id": null }`, the sign-in
endpoints return 503, the client hides the Google buttons, and password
sign-in works as normal.

Google only proves identity. It **never creates an account or assigns a role**
(account creation stays admin-gated, FR-01):

- The server verifies the Google ID token (`verifyIdToken`, audience =
  `GOOGLE_CLIENT_ID`) and requires a verified email.
- It matches an **active** user by linked Google subject id, or on first use by
  verified email, then links the subject id (audited as `link_google`).
- No match returns `404 { code: "no_account", name, email }` with no token; the
  client sends the person to Request Access with those details prefilled.
- A different Google account using an already-linked email is refused.

**How it works, in one paragraph (FR-24; `docs/requirements.md` has no FR-24
text, so this describes the code).** Google sign-in is off unless
`GOOGLE_CLIENT_ID` is set in `server/.env`; the client asks
`GET /api/auth/google/config` for that public client id and shows Google's own
"Continue with Google" button (Google Identity Services, `@react-oauth/google`)
only when it gets one (off, config answers `client_id: null` and the sign-in
endpoints answer 503). Clicking it opens
Google's sign-in, and Google hands the browser a signed ID token (a JWT about
the person; no access token, no Google API scopes, nothing about their mailbox
or calendar). The browser posts that token to `POST /api/auth/google`, and the
server verifies it with `google-auth-library` (`verifyIdToken`: Google's
signature, expiry, issuer, and audience equal to our client id, which is
checked a second time) and requires `email_verified`. It then looks for an
account already linked to that Google subject id (`sub`); failing that, for an
account whose email equals the verified Google email, and if that account has
no Google link yet it stores the `sub` in `app_user.google_sub` (audited as
`link_google`). An account linked to a different Google account, or a Google
account already linked to another user, is refused (409); a deactivated
account is refused (403). A match gets exactly the same 30-minute SHMS JWT as a
password login (same claims, including `pwd_change` if the account still has a
temporary password), and the login is audited with `{ method: 'google' }`. No
match returns 404 `no_account` with the verified name and email and no token,
and the client carries those to the Request Access form (which can also fetch
them with `POST /api/auth/google/profile`, which signs nobody in). Google never
creates an account, never picks a role or department, and its token is not
stored; after sign-in the session is SHMS's own, not Google's.

## Planned

- **Sign in with Apple.** Not implemented: it needs an Apple Developer account
  and a publicly reachable HTTPS domain registered with Apple for the return
  URL, neither of which a local prototype has. No Apple button is shown.

## Backup and restore (NFR-11)

PowerShell scripts that run the Postgres tools inside the compose container
(`docker exec`), so nothing needs installing on the host:

```powershell
.\scripts\backup.ps1     # pg_dump -Fc of shms_dev into .\backups\ (git-ignored); prints size and elapsed time
.\scripts\restore.ps1    # restores the newest backup into the scratch database shms_scratch
```

`restore.ps1` drops and recreates the target, runs `pg_restore`, prints row
counts of the main tables and the elapsed time. It refuses any target whose
name does not end in `_scratch` or `_restore`, so it cannot overwrite the live
database. Options: `-BackupFile`, `-TargetDatabase`, `-Database`/`-OutDir`
(backup), `-Container`. If script execution is blocked, run them with
`powershell -ExecutionPolicy Bypass -File scripts\backup.ps1`.

`backup.ps1 -Keep N` deletes all but the newest N dumps of that database after
a successful backup. It only touches files named `<database>-yyyyMMdd-HHmmss.dump`.

### Daily backups (Windows Task Scheduler)

```powershell
.\scripts\schedule-backup.ps1                 # register: daily at 02:00, keep the newest 14 dumps
.\scripts\schedule-backup.ps1 -At 23:30       # another time (re-running replaces the task)
.\scripts\schedule-backup.ps1 -RunNow         # register, then run once to check
.\scripts\schedule-backup.ps1 -Unregister     # remove it
Get-ScheduledTaskInfo -TaskName 'SHMS daily backup'   # last run time and result (0 = success)
```

The task "SHMS daily backup" runs `backup.ps1 -Keep 14` as the current user,
only while that user is signed in, because Docker Desktop (and so the Postgres
container) runs in the user's session. A run missed while the machine was off
or asleep starts as soon as possible. Output is appended to
`backups\backup-task.log` (UTF-16, as written by Windows PowerShell).

Scheduled backups never restore anything. **Never restore into `shms_dev`**:
`restore.ps1` refuses any target whose name does not end in `_scratch` or
`_restore`; restore into one of those, check the row counts, and only then
decide what to do with the live database by hand.

Not covered: write-ahead-log archiving (DR-09 asks for it, and the compose
file does not enable `archive_mode`), so a restore returns the database to the
last daily dump.

## Tests

```bash
cd server && npm test
```

Jest + Supertest against a separate `shms_test` database, which is created and
migrated automatically. The runner refuses any database whose name does not
end in `_test`.

| File | Covers |
|---|---|
| `handover.immutability.test.js` | Submitted records cannot be edited or deleted (API and DB triggers) |
| `handover.submit.test.js` | Template-mandated fields, specific missing-field errors, audit + notifications |
| `rbac.test.js` | Role and department scoping (401/403) |
| `handover.acknowledgement.test.js` | Acknowledgement required before `closed`; query/clarify; escalate/resolve |
| `handover.open-review.test.js` | Acknowledged → under_review: roles, department scope, 409 on other statuses, audit entry with who/when |
| `handover.carryforward.test.js` | Open/in-progress tasks carried with `carried_from_task_id` |
| `auth.login.test.js` | Login, JWT claims/expiry, bcrypt cost 12 |
| `messaging.test.js` | Cross-department direct messages, broadcast permissions (403s), private direct messages, append-only (API and DB), per-user rate limit |
| `access-request.workflow.test.js` | Request access grants nothing until approved; admin approve/reject; rate limit; RBAC |
| `auth.temporary-password.test.js` | Approve response has no password; one-time reveal (owner only, expires); first sign-in blocked until the password changes; bcrypt 12; audit without values |
| `shift-reminders.test.js` | Reminders with an injected clock: fire at the lead time and not before, never twice (incl. racing ticks), none once submitted, supervisor alerts; roster API scoping |
| `auth.google.test.js` | Google sign-in (token verification mocked): known user, no account, unverified email, deactivated user, wrong audience, conflicting Google account, config null and sign-in 503 when unconfigured |
| `handover.export.test.js` | Export holds tasks, incidents, acknowledgement, reviews and only this record's audit entries; same access as `GET /:id` |
| `notifications.unread-count.test.js` | Unread count is per user, drops on read, and `latest_id` changes when a new notification arrives |
| `admin.templates.test.js` | Template versioning keeps history |
| `report.schema.test.js` | Report triggers: submitted reports frozen, links frozen, shares append-only except `read_at` |
| `report.api.test.js` | Prefilled drafts, author-only edits, 422 with missing fields, list scopes and filters, audited reads, sharing |
| `report.download.test.js` | PDF content and footer, CSV (BOM, RFC 4180, formula neutralising), 5,000-row cap, download audit, 20-an-hour limit |
| `report.access.test.js` | Access matrix, immutability after an API submit (direct SQL too), share rules, share email without report text |
| `session.schema.test.js`, `session.api.test.js` | One session and one running timer per user, heartbeat, automatic ends with a fake clock, durations |
| `live.board.test.js`, `live.sessions.test.js` | Live board states, timers, counts, detail and timeline; access; racing requests; refused edits |
| `seed.test.js` | 57 users, a week of rostered shifts, sample sessions and reports, all `SYNTHETIC`; idempotent |

Client tests (Vitest + React Testing Library, jsdom; the API module is mocked):

```bash
cd client && npm test
```

| File | Covers |
|---|---|
| `Login.test.jsx` | Sign-in lands each role on its own dashboard; a 401 stays on the sign-in page |
| `RequireRole.test.jsx` | Signed-out or expired sessions go to `/login`; other roles are redirected to their own home |
| `DraftEditor.test.jsx` | Submit is disabled until every template-required field and the incoming user are set |
| `PrintRecord.test.jsx` | Print view renders each export section; shows the API error on 403 |
| `usePolling.test.jsx` | 5 s polling, paused while the tab is hidden |
| `format.test.js` | Times print as `YYYY-MM-DD HH:mm EAT` under three process time zones; `datetime-local` input is read as EAT |
| `Reports.test.jsx` | Reports lists and filters, New report, PDF and CSV downloads, editor with 422, read view, Share dialog |
| `LiveBoard.test.jsx`, `LiveTicks.test.jsx` | Live board rows, totals, filter, admin switcher, detail; tick maths; polling paused while hidden |
| `WorkSession.test.jsx` | First-use notice, Start/End shift, header clock, 60 s heartbeat only while visible, task timers, My work, Help |

Touch targets and horizontal scroll (IR-01), Playwright in the installed
Microsoft Edge, against a running client and API with the seed data:

```bash
cd client && npm run check:touch
# another instance: BASE_URL=http://localhost:5174 API_URL=http://localhost:4100/api npm run check:touch
```

It opens login, outgoing, incoming, supervisor and admin at 320, 768 and
1280 px, measures every button, link, input, select, checkbox and radio
(a checkbox's label counts as part of its target), checks the first Tab stop
(the skip link), and fails on anything under 44 x 44 px or any sideways
scroll. Links inside running text are listed but not failed (WCAG 2.5.5
exempts inline links). `BROWSER_CHANNEL=chromium` uses Playwright's own
Chromium instead of Edge.

Two more checks against a running, freshly seeded instance (same variables):
`npm run check:axe` (axe-core, WCAG A/AA, 22 screens at 390 px in both themes)
and `npm run check:sync` (desktop and phone contexts: a submit reaching the
phone, a theme change, and a session started on the phone reaching the
supervisor's live board, each timed).

## Integrity model

- Every state change and its `audit_log` row commit in the same transaction.
- Postgres triggers (see the migration) make non-draft records immutable,
  allow only legal status transitions, freeze tasks/incidents after submit, and
  make `audit_log`, `handover_template`, `message`, `message_read` and
  `reminder_log` append-only.
- A submitted shift report cannot change or be deleted, nor can its task
  links; `report_share` rows are append-only except `read_at`, set once.
- `work_session` and `task_timer` are append-only: only the end time (and end
  reason) and the stop time can be set, once; the heartbeat only moves forwards.
- All foreign keys are `ON DELETE RESTRICT`. Users are deactivated, never deleted.

## API overview

| Method & path | Role |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | any |
| `GET /api/handovers`, `GET /api/handovers/:id`, `GET /api/handovers/:id/export[?download=1]` | any (scoped) |
| `GET /api/handovers/meta`, `POST /api/handovers`, `PATCH /:id`, `POST /:id/tasks`, `PATCH /:id/tasks/:taskId`, `POST /:id/incidents`, `POST /:id/submit`, `POST /:id/clarify` | outgoing_staff |
| `POST /:id/acknowledgement`, `POST /:id/query` | incoming_staff |
| `POST /:id/review`, `POST /:id/resolve` | supervisor |
| `POST /:id/open-review` (acknowledged → under_review, audited) | supervisor (own department), admin |
| `GET /api/handovers/search`, `GET /api/dashboard/supervisor` | supervisor, admin |
| `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read` | any |
| `/api/admin/users[/:id]`, `/api/admin/departments`, `/api/admin/templates/:departmentCode` | admin |
| `GET /api/access-requests/departments`, `POST /api/access-requests` (rate-limited) | public |
| `GET /api/admin/access-requests`, `POST /api/admin/access-requests/:id/approve`, `POST .../:id/reject` | admin |
| `GET /api/auth/google/config` (`client_id: null` when unconfigured), `POST /api/auth/google`, `POST /api/auth/google/profile` (503 when unconfigured) | public |
| `GET /api/messages/inbox`, `GET /api/messages/sent`, `GET /api/messages/unread-count`, `GET /api/messages/:id`, `POST /api/messages`, `POST /api/messages/:id/read` | any (rules above) |
| `GET /api/directory`, `GET /api/directory/departments` | any |
| `GET /api/shifts/mine` | any |
| `GET /api/shifts`, `GET /api/shifts/:id/assignments`, `PUT /api/shifts/:id/assignments` | supervisor (own department), admin |
| `POST /api/reports`, `GET /api/reports[?scope=mine\|shared\|department]`, `GET /api/reports/share-candidates`, `GET /api/reports/:id`, `PATCH /:id`, `POST /:id/submit`, `POST /:id/share`, `GET /:id/download?format=pdf` | any (rules in FEATURES_ADDED) |
| `GET /api/reports/export?format=csv` | supervisor (own department), admin |
| `POST /api/sessions/start`, `/heartbeat`, `/end`, `GET /api/sessions/mine`, `POST /api/tasks/:id/timer/start`, `/stop` | any rostered user (timers: own draft tasks) |
| `GET /api/supervisor/live[?department_id]`, `GET /api/supervisor/live/:userId` | supervisor (own department), admin |
