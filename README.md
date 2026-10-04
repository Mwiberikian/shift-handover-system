# Shift Handover Management System (SHMS)

Final-year project prototype: digital shift handovers with acknowledgement,
supervisor review and a tamper-proof audit trail. **All seeded data is synthetic.**

Stack: React 18 (Vite, Tailwind CSS v4) · Node.js/Express · PostgreSQL 15 · JWT ·
node-pg-migrate · node-cron.

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

Seeded logins (password `Password123!`):

| Department | Outgoing | Incoming | Supervisor |
|---|---|---|---|
| Ground Operations (`ground_ops`) | KQ1001 | KQ1002 | KQ1003 |
| Aircraft Maintenance (`maint`) | KQ2001 | KQ2002 | KQ2003 |
| Customer Service (`cust_svc`) | KQ3001 | KQ3002 | KQ3003 |
| Flight Operations (`flight_ops`) | KQ4001 | KQ4002 | KQ4003 |
| Admin | KQ9001 | | |

The seed gives Ground Ops an acknowledged previous-shift record with an open
task, so submitting the current Ground Ops handover demonstrates carry-forward.
It also rosters each department's outgoing user on the current shift and its
incoming user on the next one.

## Features at a glance

- Structured handovers per department template, carry-forward of open tasks,
  acknowledgement or query, supervisor review/escalation, append-only audit log.
- Request access (public form; an admin approves and assigns the role).
- Optional Sign in with Google for existing accounts (see below).
- In-app messaging, shift reminders, a supervisor roster.
- Light and dark themes (follows the OS until the user picks one), a help
  centre at `/help`, and a support contact bar driven by `client/.env`.

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
| `GOOGLE_CLIENT_ID` | unset | Enables Sign in with Google; unset = disabled (503) |
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
the Google endpoints return 503, the client hides the Google buttons, and
password sign-in works as normal.

Google only proves identity. It **never creates an account or assigns a role**
(account creation stays admin-gated, FR-01):

- The server verifies the Google ID token (`verifyIdToken`, audience =
  `GOOGLE_CLIENT_ID`) and requires a verified email.
- It matches an **active** user by linked Google subject id, or on first use by
  verified email, then links the subject id (audited as `link_google`).
- No match returns `404 { code: "no_account", name, email }` with no token; the
  client sends the person to Request Access with those details prefilled.
- A different Google account using an already-linked email is refused.

## Planned

- **Sign in with Apple.** Not implemented: it needs an Apple Developer account
  and a publicly reachable HTTPS domain registered with Apple for the return
  URL, neither of which a local prototype has. No Apple button is shown.

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
| `handover.carryforward.test.js` | Open/in-progress tasks carried with `carried_from_task_id` |
| `auth.login.test.js` | Login, JWT claims/expiry, bcrypt cost 12 |
| `messaging.test.js` | Cross-department direct messages, broadcast permissions (403s), private direct messages, append-only (API and DB), per-user rate limit |
| `access-request.workflow.test.js` | Request access grants nothing until approved; admin approve/reject; rate limit; RBAC |
| `shift-reminders.test.js` | Reminders with an injected clock: fire at the lead time and not before, never twice (incl. racing ticks), none once submitted, supervisor alerts; roster API scoping |
| `auth.google.test.js` | Google sign-in (token verification mocked): known user, no account, unverified email, deactivated user, wrong audience, conflicting Google account, 503 when unconfigured |
| `admin.templates.test.js` | Template versioning keeps history |

## Integrity model

- Every state change and its `audit_log` row commit in the same transaction.
- Postgres triggers (see the migration) make non-draft records immutable,
  allow only legal status transitions, freeze tasks/incidents after submit, and
  make `audit_log`, `handover_template`, `message`, `message_read` and
  `reminder_log` append-only.
- All foreign keys are `ON DELETE RESTRICT`. Users are deactivated, never deleted.

## API overview

| Method & path | Role |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | any |
| `GET /api/handovers`, `GET /api/handovers/:id` | any (scoped) |
| `GET /api/handovers/meta`, `POST /api/handovers`, `PATCH /:id`, `POST /:id/tasks`, `PATCH /:id/tasks/:taskId`, `POST /:id/incidents`, `POST /:id/submit`, `POST /:id/clarify` | outgoing_staff |
| `POST /:id/acknowledgement`, `POST /:id/query` | incoming_staff |
| `POST /:id/review`, `POST /:id/resolve` | supervisor |
| `GET /api/handovers/search`, `GET /api/dashboard/supervisor` | supervisor, admin |
| `GET /api/notifications`, `POST /api/notifications/:id/read` | any |
| `/api/admin/users[/:id]`, `/api/admin/departments`, `/api/admin/templates/:departmentCode` | admin |
| `GET /api/access-requests/departments`, `POST /api/access-requests` (rate-limited) | public |
| `GET /api/admin/access-requests`, `POST /api/admin/access-requests/:id/approve`, `POST .../:id/reject` | admin |
| `GET /api/auth/google/config`, `POST /api/auth/google`, `POST /api/auth/google/profile` (503 when unconfigured) | public |
| `GET /api/messages/inbox`, `GET /api/messages/sent`, `GET /api/messages/unread-count`, `GET /api/messages/:id`, `POST /api/messages`, `POST /api/messages/:id/read` | any (rules above) |
| `GET /api/directory`, `GET /api/directory/departments` | any |
| `GET /api/shifts/mine` | any |
| `GET /api/shifts`, `GET /api/shifts/:id/assignments`, `PUT /api/shifts/:id/assignments` | supervisor (own department), admin |
