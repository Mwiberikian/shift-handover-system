// SMTP email gateway (IR-05), through nodemailer.
//
// Configuration comes only from the environment (see server/.env.example).
// Nothing is sent unless EMAIL_ENABLED=true, and never to an address outside
// EMAIL_ALLOWED_DOMAINS unless EMAIL_ALLOW_EXTERNAL=true. The development
// default is the Mailpit container from docker-compose.yml (SMTP on 1025, web
// UI on 8025), which catches every message and delivers none.
const nodemailer = require('nodemailer');

const flag = (v) => String(v ?? '').trim().toLowerCase() === 'true';

// Read on every call so tests (and a restarted process) see current values.
function emailConfig(env = process.env) {
  return {
    enabled: flag(env.EMAIL_ENABLED),
    host: env.SMTP_HOST || 'localhost',
    port: Number(env.SMTP_PORT) || 1025,
    secure: flag(env.SMTP_SECURE),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || 'Shift Handover <no-reply@shms.example>',
    appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
    allowedDomains: (env.EMAIL_ALLOWED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
    allowExternal: flag(env.EMAIL_ALLOW_EXTERNAL),
  };
}

// nodemailer SMTP options. Credentials are sent only when a user is set.
function transportOptions(cfg = emailConfig()) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user && { auth: { user: cfg.user, pass: cfg.pass } }),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
}

const domainOf = (address) => {
  const m = /^[^\s@<>]+@([^\s@<>]+)$/.exec(String(address || '').trim());
  return m ? m[1].toLowerCase() : null;
};

// null when the address may be emailed, otherwise the reason it may not.
function refusalReason(address, cfg = emailConfig()) {
  const domain = domainOf(address);
  if (!domain) return 'not a valid email address';
  if (cfg.allowExternal) return null;
  if (!cfg.allowedDomains.includes(domain)) return `domain '${domain}' is not in EMAIL_ALLOWED_DOMAINS`;
  return null;
}

class EmailRefused extends Error {}

let transport = null;
let transportKey = null;

// One transport per configuration; tests replace it with setTransport().
function getTransport(cfg = emailConfig()) {
  const key = JSON.stringify(transportOptions(cfg));
  if (!transport || (transportKey !== key && transportKey !== 'override')) {
    transport = nodemailer.createTransport(transportOptions(cfg));
    transportKey = key;
  }
  return transport;
}

function setTransport(t) {
  transport = t;
  transportKey = t ? 'override' : null;
}

// Sends one message. Throws EmailRefused if email is off or the recipient is
// not allowed (checked again here, not only when the email was queued), or
// the transport's own error if the gateway fails.
async function sendEmail({ to, subject, text }, cfg = emailConfig()) {
  if (!cfg.enabled) throw new EmailRefused('email is disabled (EMAIL_ENABLED is not true)');
  const reason = refusalReason(to, cfg);
  if (reason) throw new EmailRefused(`refused: ${reason}`);
  return getTransport(cfg).sendMail({
    from: cfg.from, to, subject, text,
  });
}

module.exports = {
  emailConfig, transportOptions, refusalReason, sendEmail, setTransport, getTransport, EmailRefused,
};
