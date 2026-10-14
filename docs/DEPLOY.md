# Deploying SHMS

SHMS deploys as three parts:

| Part | What it is | Host type |
|---|---|---|
| Client | The built React app (`client/dist`): static files only | Any static host with an SPA fallback (Netlify, Cloudflare Pages, Vercel, S3 + CloudFront, nginx) |
| API | The Express server, as the container in `server/Dockerfile` | Any container host (Render, Fly.io, Railway, Azure Container Apps, Cloud Run with min instances = 1, a VM running Docker) |
| Database | PostgreSQL 15 | Managed Postgres 15 (Neon, Supabase, RDS, Azure Database for PostgreSQL, Cloud SQL) |

The repository holds no secrets. Every secret goes in the host's environment
settings and never in a file you commit.

## Before you start: the API must stay on

The API runs its own jobs, in the same process, every minute
(`server/src/jobs/reminders.js`):

- **work sessions**: ends sessions with no heartbeat for 10 minutes, and any
  session 30 minutes after its shift ends, and stops their timers;
- **shift reminders**: shift starting, handover due, acknowledgement pending,
  and the supervisor alerts for an unacknowledged record or a missing handover;
- **the email outbox**, when `EMAIL_ENABLED=true`.

There is no external scheduler. **These jobs only run while an API instance is
running, so the API needs an always-on instance.** Free tiers that sleep an idle
service (or scale to zero) **will miss reminders and leave sessions open** until
the next request wakes the instance. After a wake-up, reminders more than
`REMINDER_LOOKBACK_MINUTES` (60) late are skipped, not sent. Choose a plan with
at least one instance that never sleeps.

Run **one** API instance. These are kept in the API's memory and are not shared
between instances: the rate-limit counters, and the one-time copy of a new
user's temporary password (10 minutes). Reminders cannot be sent twice
(`reminder_log` is unique), but a second instance would weaken the rate limits.

## 1. Database: managed PostgreSQL 15

1. Create a PostgreSQL **15** database. Pick the region nearest the API host.
2. Create a database user for the app and note the connection string, for
   example
   `postgresql://shms_app:<password>@db.example.net:5432/shms?sslmode=require`.
   Keep `sslmode=require` if the provider gives it.
3. Allow connections from the API host (by IP allow-list or private network,
   as the provider offers).
4. Turn on the provider's automated backups. `scripts/backup.ps1` covers local
   development only.

Do not run `npm run seed` against production: it wipes data, and it refuses to
run when `NODE_ENV=production`.

## 2. API: the container

The image is built from `server/` (Node 22 on Alpine, runs as the unprivileged
`node` user, health check on `/api/health`):

```bash
docker build -t shms-api server
```

Most hosts build it for you from the repository: point the service at the
`server` directory (or at `server/Dockerfile`).

1. Create a web service from the image or the `server` directory. The
   container listens on `PORT` (default `4000`); set `PORT` if the host assigns
   one.
2. Set the environment variables from the table below. At minimum:
   `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`.
   Generate the secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   In production the API **refuses to start** if `JWT_SECRET` is unset or still
   `change_me`, or if `CLIENT_ORIGIN` or `DATABASE_URL` is unset. The log
   lists each problem.
3. Set the **release command** (also called pre-deploy command) to
   `npm run migrate up`. Migrations never run when the server boots. The host
   runs them once per deploy, before the new version takes traffic. With plain
   Docker:

   ```bash
   docker run --rm --env-file shms.env shms-api npm run migrate up
   ```

4. Set the health-check path to `/api/health`. It answers 200 only when the
   database answers.
5. Set the instance to **always on** with exactly one instance (see above).
6. If more than one proxy sits in front of the API, set `TRUST_PROXY` to the
   number of proxies, so per-IP rate limits see the client and not the load
   balancer. The production default is 1.

## 3. Client: the static site

The client is built once per environment, because Vite builds the `VITE_*`
values into the files.

1. Create a static site from the repository with:
   - base directory: `client`
   - build command: `npm ci && npm run build`
   - publish directory: `client/dist`
2. Set the build-time variables (table below), mainly
   `VITE_API_URL=https://<api-host>/api`.
3. Add an **SPA fallback**: every unknown path serves `/index.html` with
   status 200, so links such as `/supervisor/queue` work on reload. Netlify:
   `/* /index.html 200` in `client/public/_redirects`. Cloudflare Pages and
   Vercel do this for SPAs by default. nginx: `try_files $uri /index.html;`.
4. Serve over HTTPS. Browsers allow the installable app, the service worker and
   desktop alerts only on HTTPS (or on `localhost`).
5. Put the site's final address in the API's `CLIENT_ORIGIN` (and `APP_URL`).
   With a custom domain as well as the host's default address, list both,
   comma-separated.

## Environment variables

### API (`server`, runtime)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | | `production` (turns on the start-up checks and the proxy default) |
| `DATABASE_URL` | yes | | Postgres connection string (secret) |
| `JWT_SECRET` | yes | | Signs session tokens (secret). Refused if unset or `change_me` in production |
| `CLIENT_ORIGIN` | yes | | UI origin(s) allowed by CORS, comma-separated, no trailing slash |
| `PORT` | no | `4000` | Port the server listens on |
| `JWT_EXPIRY` | no | `30m` | Session length |
| `TRUST_PROXY` | no | `1` in production, else off | Proxies in front of the API (a hop count, or `false`) |
| `UV_THREADPOOL_SIZE` | no | min(12, CPUs) | libuv threads (bcrypt hashing) |
| `GOOGLE_CLIENT_ID` | no | unset (off) | Sign in with Google. Add the client's origin as an authorised JavaScript origin in Google Cloud Console |
| `ACCESS_REQUEST_RATE_LIMIT` | no | `5` | Public access requests per IP per hour |
| `MESSAGE_RATE_LIMIT` | no | `30` | Messages per user per hour |
| `MESSAGE_EMAIL_RATE_LIMIT` | no | `10` | Email/Both messages per user per hour |
| `CALENDAR_FEED_RATE_LIMIT` | no | `60` | Calendar feed requests per IP per 15 minutes |
| `REMINDERS_ENABLED` | no | `true` | `false` turns shift reminders off |
| `REMINDER_SHIFT_START_MINUTES` | no | `30` | Lead time before shift start |
| `REMINDER_HANDOVER_DUE_FIRST_MINUTES` | no | `30` | First handover-due reminder before shift end |
| `REMINDER_HANDOVER_DUE_FINAL_MINUTES` | no | `10` | Final handover-due reminder before shift end |
| `REMINDER_ACK_PENDING_MINUTES` | no | `15` | After the incoming shift starts |
| `REMINDER_UNACK_ALERT_MINUTES` | no | `120` | Supervisor alert after the incoming shift starts |
| `REMINDER_LOOKBACK_MINUTES` | no | `60` | Reminders later than this are skipped, not sent |
| `EMAIL_ENABLED` | no | `false` | `true` sends email notifications through SMTP |
| `SMTP_HOST` | with email | `localhost` | SMTP server |
| `SMTP_PORT` | with email | `1025` | SMTP port |
| `SMTP_SECURE` | with email | `false` | `true` for implicit TLS (port 465) |
| `SMTP_USER` | with email | | SMTP user (secret) |
| `SMTP_PASS` | with email | | SMTP password (secret) |
| `EMAIL_FROM` | with email | `Shift Handover <no-reply@shms.example>` | From address |
| `APP_URL` | with email | `http://localhost:5173` | Client address, used in email links |
| `EMAIL_ALLOWED_DOMAINS` | with email | | Recipient domains, comma-separated |
| `EMAIL_ALLOW_EXTERNAL` | no | `false` | `true` allows other domains |
| `EMAIL_RETRY_BASE_MINUTES` | no | `1` | Outbox retry backoff base |
| `EMAIL_NOTIFICATION_TYPES` | no | see `server/.env.example` | Notification types that may be emailed |

### Client (`client`, build time)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | yes | API base URL, ending in `/api`, e.g. `https://api.shms.example/api` |
| `VITE_SUPPORT_EMAIL` | no | Support email in the utility bar and help page. Blank hides it |
| `VITE_SUPPORT_PHONE` | no | Support phone. Blank hides it |

`VITE_*` values end up in public JavaScript. Never put a secret in one.

## First-deploy checklist

- [ ] Postgres 15 created, backups on, API host allowed to connect.
- [ ] API service created from `server/Dockerfile`, **always on, one instance**.
- [ ] `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (new random value) and
      `CLIENT_ORIGIN` set in the host's environment, not in a file.
- [ ] Release command `npm run migrate up` set. The first deploy's log shows
      every migration applied.
- [ ] Health check `/api/health` returns `{"status":"ok"}` from the public URL.
- [ ] Client built with `VITE_API_URL` pointing at the API, SPA fallback on,
      HTTPS on.
- [ ] `CLIENT_ORIGIN` (and `APP_URL`) equal the client's exact origin. A CORS
      error in the browser console means they don't match.
- [ ] First admin account created: run the seed only against a non-production
      database, or insert the admin with a bcrypt (cost 12) hash, then change
      the password at first sign-in.
- [ ] Sign in, open a deep link such as `/supervisor/queue` and reload it (tests
      the SPA fallback).
- [ ] Within two minutes of start-up, the API log shows
      `Jobs started (every minute): sessions on, reminders on, ...`.
- [ ] Optional: `GOOGLE_CLIENT_ID` set and the client's origin authorised in
      Google Cloud Console. SMTP credentials set and `EMAIL_ENABLED=true`.
- [ ] Rollback plan: redeploy the previous image tag. The migrations so far
      only add tables and columns, but read any new migration before relying
      on the previous image against the newer schema.
