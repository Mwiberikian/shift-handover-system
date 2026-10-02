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
