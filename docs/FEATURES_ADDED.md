# Features added in Parts J and K: what they do and do not do

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
