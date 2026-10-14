# Features added: what they do and do not do

Parts P, Q and R (hosting, installable app, sync and push) are described first,
then Parts J and K. All data used to build and test them is synthetic (DR-11):
the seed accounts (`@shms.example`), the test fixtures (`@test.example`) and
every record, message, shift and push subscription are invented.

---

# Parts P, Q and R (2026-10-14)

## P. Hosting prerequisites (deployment: [DEPLOY.md](DEPLOY.md))

**What it does**

- `server/Dockerfile`: Node 22 on Alpine, production dependencies only, runs
  as the unprivileged `node` user, health check on `/api/health`. It starts
  the server only. Migrations are a separate release command,
  `npm run migrate up` (so `node-pg-migrate` moved to `dependencies`).
  `.dockerignore` keeps `.env`, tests and `node_modules` out of the image.
- `CLIENT_ORIGIN` takes a comma-separated list. `trust proxy` defaults to one
  hop in production (`TRUST_PROXY` overrides it), so per-IP rate limits see
  the client and not the load balancer. helmet stays on.
- In production (`NODE_ENV=production`) the server **refuses to start** if
  `JWT_SECRET` is unset or still `change_me`, or if `CLIENT_ORIGIN` or
  `DATABASE_URL` is unset, or if `PUSH_ENABLED=true` with a VAPID value
  missing. The log lists each problem.

**What it does not do**

- It deploys nothing. The image was built and run locally (non-root, healthy,
  11 migrations applied by the release command), not on a hosting provider.
- It does not terminate TLS. HTTPS comes from the host (NFR-08 stays Not met
  for the code itself).
- The jobs (sessions, reminders, email outbox) run inside the API process.
  A host that sleeps idle services will miss them. DEPLOY.md says so, and asks
  for one always-on instance, because rate-limit counters and the one-time
  password copy are kept in memory.

## Q. Installable app (FR-32, draft)

**What it does**

- `vite-plugin-pwa` (2.0.0) builds a manifest: name "SHMS – Shift Handover
  Management", short name SHMS, `display: standalone`, start URL and scope
  `/`, theme `#0d0d0d` (brand-black) and background `#fafafa` (ink-50) from the
  design tokens, icons 192, 512 and maskable 512. `index.html` adds the
  apple-touch-icon (180 px), the iOS and Android meta tags and
  `viewport-fit=cover`. The fixed header, side rail, tab bar and sheets pad
  themselves with `env(safe-area-inset-*)`.
- The icons are a generic "SH" monogram (`client/scripts/generate-icons.mjs`),
  **not** the airline logo.
- The service worker precaches the **app shell only**: HTML, JS, CSS, the font
  and the icons (45 files, about 970 KiB). Page photos are not precached. API
  requests (any origin, `/api/…`) and anything sent with `Authorization` are
  `NetworkOnly`: no response is ever stored. Deep links fall back to the shell.
- Offline, every screen shows "You are offline. Changes cannot be saved."
  When a new build is ready, "Update available" offers Reload or Later. The
  new version never replaces an open page by itself.
- "Install app" appears in the account menu when the browser fires
  `beforeinstallprompt`. On iPhone and iPad (no such event) the same item shows
  "In Safari, tap Share, then Add to Home Screen."
- Below 768 px a bottom tab bar: Outgoing Handover / Messages / Me; Incoming
  Inbox / Messages / Me; Supervisor Overview / Messages; Admin Users /
  Templates / Requests / Me. "Me" opens a sheet with the account rows (email
  alerts, push, calendar, install, theme, password), the role's other screens
  (My handovers, My shifts, …), Help and Log out. The routes, components,
  tokens and copy are the desktop ones; the header and its drawer stay.
- On phones, tables become cards (every column, hidden ones included, as label
  and value), inputs are 16 px so iOS does not zoom, sticky action bars (the
  Submit bar, the acknowledge bar) sit above the tab bar, and every tab and
  row is at least 44 px.

**What it does not do**

- **No Reports or Live tabs.** The brief's Reports (all roles) and Live
  (supervisor) tabs point at screens that do not exist yet (shift reports,
  the live board). They are defined in `client/src/components/shell/nav.js`
  as `planned` and stay hidden until their routes exist, so the supervisor
  bar has two tabs and Outgoing and Incoming have three.
- No offline data and no offline queue (Section 1.5.1): nothing typed offline
  is kept for later.
- Not tested on a real phone. Installability was checked in headless Edge
  (Chromium reports no installability errors); the iOS hint only in jsdom.

## R1. Preferences on every device (FR-33, draft)

**What it does**

- `app_user.theme_preference` (`light`, `dark` or `system`, default `system`,
  database check). `PATCH /api/auth/me/preferences` takes `theme_preference`
  and/or `email_notifications` and returns both. Changes are audited with
  only the fields that changed.
- Sign-in and `/api/auth/me` return both. The client applies the saved theme
  as soon as the profile arrives and caches it in `localStorage`, so the next
  first paint on that device has the right theme. Changing the theme while
  signed in saves it to the server; signed out, it stays on the device.

**What it does not do**

- It does not push a change to sessions that are already open. Another
  device picks it up on its next sign-in or reload (R4: about 0.5 s
  including the reload).
- Push-on-this-device is per device by design and is not synced.

## R2. Refetch on return

**What it does**

- When the user comes back (tab shown, window focused, connection back) the
  bell, the unread counts, the handover lists and the open record refetch at
  once. The bell's 5 s poll is unchanged and still pauses while the tab is
  hidden.
- A new notification also asks open screens to refetch, so an incoming
  handover appears in the inbox without a reload (R4: about 3.4 s).
- The utility bar shows "Updated just now" (then "Updated 20 s ago", amber
  after 30 s or when offline). Tapping it refetches.

**What it does not do**

- No websockets or server push for screens: still polling plus these
  triggers.
- No live board is refetched, because none exists yet.
- A draft being edited keeps its unsaved text when the record refetches.

## R3. Push notifications (FR-34, draft)

**What it does**

- A `push` channel behind `notify()`, requested wherever email is: handover
  events, reminders, and messages sent as Email or Both. It sends only for the
  email-eligible types (`EMAIL_NOTIFICATION_TYPES`), to every device the
  recipient turned on, if the recipient is active.
- The payload is `{ "title": …, "link": … }` only. The title is the same fixed
  phrase an email subject uses ("A handover has been submitted", or a
  reminder's fixed title). The link is a path inside the app for the
  recipient's role. No handover, report or message content, no names.
- Sending waits until the transaction commits (`afterCommit` in
  `server/src/db/tx.js`). A rolled-back change sends nothing, and a slow or
  failing push service never delays or fails the handover.
- A 404 or 410 from the push service deletes that subscription; other errors
  add to `failed_count`. Success sets `last_success_at`.
- `push_subscription` (user_id, endpoint unique and https-only, p256dh, auth,
  user_agent, created_at, last_success_at, failed_count).
  `POST`/`DELETE /api/push/subscribe`, `GET /api/push/config`. Subscribing and
  unsubscribing are audited with the user agent, never the endpoint.
- "Push notifications on this device" in the account menu (and the Me sheet)
  shows only when the browser supports push and the server has it on. The
  browser's permission prompt appears only when the switch is clicked.
  Signing out removes this device's subscription.
- `npm run vapid` prints a key pair. `PUSH_ENABLED=false` by default.

**What it does not do**

- **No push has reached a real device.** `web-push` is mocked in the tests,
  and push stayed off on the local instance. Delivery through a browser push
  service is unverified.
- No quiet hours, per-type settings or badges on the app icon.
- On iPhone and iPad, push works only in the installed app (iOS 16.4+).
- A message sent as "System notification" (in-app only) is not pushed.

## Tests for Parts P, Q and R

| File | Covers |
|---|---|
| `server/tests/deploy.dockerfile.test.js` | Node 22 Alpine, non-root user, health check, no migrations on boot, release command available |
| `server/tests/config.production.test.js` | Refuses to start with JWT_SECRET unset or `change_me` (real child process), CLIENT_ORIGIN list, trust proxy, helmet headers |
| `server/tests/deploy.docs.test.js` | DEPLOY.md lists every env variable the server reads, the three hosts, the always-on warning |
| `server/tests/preferences.sync.test.js` | Theme and email preferences: defaults, sign-in returns them, validation, check constraint, audit |
| `server/tests/push.test.js` | Mocked web-push: subscribe/unsubscribe, payload title and link only, every device, opt-out, inactive users, eligible types, after commit only, rollback, failures, 404/410 pruning, off by default |
| `server/tests/seed.truncate.test.js` | The seed and the test reset truncate every table (push_subscription broke the seed) |
| `client/src/test/pwaManifest.test.js` | Manifest fields, token colours, icon sizes, apple-touch-icon, meta tags, safe areas |
| `client/src/test/pwaServiceWorker.test.jsx` | NetworkOnly for API and Authorization requests, shell-only precache, offline banner, update prompt |
| `client/src/test/InstallApp.test.jsx`, `InstallAppIOS.test.jsx` | Install item on beforeinstallprompt; iOS hint |
| `client/src/test/MobileLayout.test.jsx` | Tabs per role, Me sheet, tables as cards, 16 px inputs, bars above the tabs |
| `client/src/test/PreferenceSync.test.jsx` | Saved theme applied and cached; change saved to the server |
| `client/src/test/RefreshOnReturn.test.jsx`, `RefreshScreens.test.jsx` | Return triggers, 5 s polling, indicator, inbox refetch |
| `client/src/test/PushSwitch.test.jsx`, `PushSwitchOff.test.jsx` | Permission only on click, subscribe/unsubscribe, hidden when off, service worker shows the title and opens the link |
| `client/e2e/sync.mjs` | R4: two contexts (1280 and 390 px), timings |
| `client/e2e/axe-phone.mjs` | R5: axe at 390 px, 15 screens, both themes |

---

# Parts J and K

Date: 2026-10-14. Covers email notifications, "Send as" for messages, the
Google Calendar link, the `.ics` download and the calendar subscription feed.
All data used to build and test them is synthetic (DR-11): the seed accounts
(`@shms.example`), the test fixtures (`@test.example`) and every record,
message and shift are invented.

---

## 1. Email notifications (IR-05, IR-06, IR-07)

**What it does**

- Sends a short email alert, through SMTP (`nodemailer`), for these
  notification types: handover submitted, query raised, query answered,
  escalated, escalation resolved, shift reminders, and messages whose sender
  chose Email or Both. The list can be changed with `EMAIL_NOTIFICATION_TYPES`.
- Every notification first goes in-app. `notify()`
  (`server/src/modules/notifications/notify.js`) is the only code that writes
  notification rows; email is a channel behind it.
- The handover's own transaction only queues the email (`email_outbox` row).
  The jobs tick (every minute) sends it afterwards. A failed send is retried
  after 1, 2 and 4 minutes (`EMAIL_RETRY_BASE_MINUTES`), then marked failed.
  The outcome (`pending`, `sent`, `failed`) is stored on the notification.
- If the mail gateway is down, nothing about the handover changes: the in-app
  notification is there, the record stays `submitted`, and once an email has
  finally failed the supervisor dashboard shows it ("could not be delivered",
  with the recipient's name, what it was about and when) for that department.
- Each user can turn email alerts off in their account menu (top right). They
  then get in-app notifications only.
- Development default: the Mailpit container from `docker-compose.yml`
  (SMTP on 1025, web UI on http://localhost:8025) catches every message.

**What it does not do**

- It is **off** unless `EMAIL_ENABLED=true`.
- It never emails an address outside `EMAIL_ALLOWED_DOMAINS` (default in
  `.env.example`: `shms.example`) unless `EMAIL_ALLOW_EXTERNAL=true`. That
  is checked when an email is queued and again when it is sent.
- The email holds a subject and a few lines: the notification's title (for
  example "A handover has been submitted") and a link to `APP_URL`. **No
  handover content** (summary, tasks, incidents, comments), **no message
  subject or text**, no names from reminder text, no record ids, **no
  passwords**. Access-request approvals send no email at all, and temporary
  passwords are never emailed.
- Acknowledgements and ordinary approvals (`handover_closed`) are not emailed.
- It does not send HTML email, attachments or replies, and it does not read a
  mailbox.
- It is not instant: an email leaves within about a minute (one jobs tick).
- It has not been used with a real mail provider. It was tested with a
  stubbed transport and with Mailpit. No real SMTP credentials are in the
  repository; set them only in your own `.env`.
- With more than one API process, queued emails are still sent only once per
  attempt (rows are claimed with `FOR UPDATE SKIP LOCKED`), but this was only
  tested with two overlapping runs in one process.

## 2. "Send as" for messages

**What it does**

- Supervisors and admins choose, when composing: **System notification**
  (default), **Email** or **Both**. Every option puts the message in the
  recipients' Messages inbox.
  - *System notification*: as before. A direct message also appears under the
    bell; broadcasts show in the Messages unread count.
  - *Both*: every recipient (one person, a department or everyone; active
    users only, never the sender) gets a bell notification and an email alert.
  - *Email*: every recipient gets an email alert. The bell row that tracks the
    email starts as read, so the alert is not doubled. If no email can be
    queued for someone (they opted out, their domain is not allowed, email is
    off) their bell row stays unread. If the email finally fails, the bell
    row is turned back to unread. Either way the alert still arrives in-app.
- Email and Both have their own limit of 10 sends per user per hour
  (`MESSAGE_EMAIL_RATE_LIMIT`), on top of the general 30.

**What it does not do**

- Outgoing and incoming staff cannot email (403); they only see System
  notification.
- The email does not contain the message. It says "You have a new message"
  and links to the app.
- Recipients who turned email alerts off get no email.
- It does not email people outside the system or outside the allowed domains.

## 3. "Add to Google Calendar" (Roster and My shifts)

**What it does**

- Each shift on the Roster (supervisors, admins) and on the new **My shifts**
  page (your own rostered shifts for the next 30 days) has an "Add to Google
  Calendar" button. It opens Google's event template
  (`calendar.google.com/calendar/render?action=TEMPLATE…`) prefilled with the
  title ("Night shift - Ground Operations"), start and end in Nairobi time
  (`ctz=Africa/Nairobi`), the department as location, and one line of detail.

**What it does not do**

- It needs no Google credentials and SHMS does not talk to Google. The
  browser opens Google's page; nothing is saved until the user saves it there.
- It is a one-off copy. If the roster changes, the Google event does not.
- Once saved, the shift's name, times and department are held by Google.
  Both pages say so.
- No handover content and no colleagues' names are put in the link.

## 4. "Download .ics" (Roster and My shifts)

**What it does**

- Downloads an iCalendar file for one shift, or for the next 30 days (your own
  shifts on My shifts; the department roster on the Roster page for supervisors
  and admins). `GET /api/shifts/calendar.ics`.
- The file is written by hand (`server/src/utils/ics.js`), no new dependency:
  RFC 5545 escaping, 75-octet line folding, CRLF, UTC times, and a reminder
  30 minutes before each shift.

**What it does not do**

- Staff can download only shifts they are rostered on. Supervisors can
  download only their own department; admins can download any.
- It is a snapshot; later roster changes are not reflected.
- It carries shift name, times and department only.

## 5. Calendar subscription feed

**What it does**

- From the account menu, "Calendar subscription" creates a private URL
  (`/api/shifts/calendar/<token>.ics`) to paste into Google Calendar ("From
  URL"), Outlook ("Subscribe from web") or any app that takes iCalendar feeds.
  The app fetches it on its own schedule, so roster changes appear there.
- The feed lists your rostered shifts from 30 days back to 90 days ahead,
  with a reminder 30 minutes before each.
- The token is 32 random bytes. It is shown once; only its SHA-256 is stored.
  "New link" replaces it (the old URL stops working at once); "Revoke" removes
  it. Creating, regenerating and revoking are audited, without the token.
- The endpoint is rate-limited per IP (60 per 15 minutes by default). An
  unknown, revoked or malformed token, or a deactivated account, gets the same
  plain 404.

**What it does not do**

- No handover content, no names, no record data: shift name, times and
  department only.
- Calendar apps refresh on their own timetable (often hours), not instantly.
- The URL is the credential. Anyone who has it can read your shift times until
  you revoke it. The dialog warns about this.
- The prototype API runs over plain HTTP (NFR-08 is not met), so the URL, with
  its token, travels unencrypted unless the API is put behind TLS.
- Shifts added to an external calendar leave the system; this is stated in one
  line on My shifts, the Roster and the subscription dialog.

---

## Configuration (server/.env.example)

| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_ENABLED` | `false` | Turns email on |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `localhost`, `1025`, `false` | Mailpit in development |
| `SMTP_USER`, `SMTP_PASS` | empty | Set only in your own `.env` |
| `EMAIL_FROM` | `Shift Handover <no-reply@shms.example>` | Sender |
| `APP_URL` | `http://localhost:5173` | The only link in an email |
| `EMAIL_ALLOWED_DOMAINS` | `shms.example` | Recipient domains |
| `EMAIL_ALLOW_EXTERNAL` | `false` | Allow any domain |
| `EMAIL_RETRY_BASE_MINUTES` | `1` | Retry after base, 2x, 4x |
| `EMAIL_NOTIFICATION_TYPES` | see section 1 | Types that may be emailed |
| `MESSAGE_EMAIL_RATE_LIMIT` | `10` | Email/Both sends per user per hour |
| `CALENDAR_FEED_RATE_LIMIT` | `60` | Feed requests per IP per 15 minutes |

## Tests

| File | Covers |
|---|---|
| `server/tests/notify.service.test.js` | One service writes all notifications; channels; transactions |
| `server/tests/email.mailer.test.js` | Config from env, off by default, domain allowlist |
| `server/tests/email.outbox.test.js` | Queue only in the transaction; retries at 1, 2, 4 min with a fake clock; failed; recovery; configurable base; no double send |
| `server/tests/email.degraded.test.js` | Gateway down: in-app delivered, record stays submitted, dashboard lists failures per department |
| `server/tests/email.content.test.js` | No handover content, names or passwords; eligible types; reminders; opt-out |
| `server/tests/messaging.send-as.test.js` | Role limits, each option, broadcasts, opt-out, failed-email fallback, separate rate limit |
| `server/tests/calendar.download.test.js` | ICS escaping and folding; download access rules |
| `server/tests/calendar.feed.test.js` | Valid ICS with VALARM, only own shifts, revoked 404, no handover text, hashed token, rate limit |
| `client/src/test/Calendar.test.jsx` | Google link in Nairobi time under another browser zone; My shifts; the note |
| `client/src/test/UserMenu.test.jsx` | Email alerts switch; calendar subscription dialog |
| `client/src/test/ComposeSendAs.test.jsx` | Send as shown only to supervisors and admins |
| `client/src/test/SupervisorOverview.test.jsx` | Failed-email card |
