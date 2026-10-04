# Shift Handover Management System (SHMS)

Final-year project prototype: digital shift handovers with acknowledgement,
supervisor review and a tamper-proof audit trail. **All seeded data is synthetic.**

Stack: React 18 (Vite) · Node.js/Express · PostgreSQL 15 · JWT · node-pg-migrate.

## Run locally

```bash
docker compose up -d                 # Postgres 15 on :5432

cd server
cp .env.example .env                 # then set JWT_SECRET
npm install
npm run migrate up
npm run seed                         # wipes and reseeds dev data
npm run dev                          # API on http://localhost:4000

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
| `auth.google.test.js` | Google sign-in (token verification mocked): known user, no account, unverified email, deactivated user, wrong audience, conflicting Google account, 503 when unconfigured |
| `admin.templates.test.js` | Template versioning keeps history |

## Integrity model

- Every state change and its `audit_log` row commit in the same transaction.
- Postgres triggers (see the migration) make non-draft records immutable,
  allow only legal status transitions, freeze tasks/incidents after submit, and
  make `audit_log` and `handover_template` append-only.
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
