// IR-05 email gateway: configuration only from the environment, off by
// default, and never to a domain outside EMAIL_ALLOWED_DOMAINS unless
// EMAIL_ALLOW_EXTERNAL=true.
const {
  emailConfig, transportOptions, refusalReason, sendEmail, setTransport, EmailRefused,
} = require('../src/modules/notifications/email/mailer');

afterEach(() => setTransport(null));

const capture = () => {
  const sent = [];
  setTransport({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } });
  return sent;
};

test('defaults: disabled, Mailpit on localhost:1025, no credentials', () => {
  const cfg = emailConfig({});
  expect(cfg).toMatchObject({
    enabled: false, host: 'localhost', port: 1025, secure: false, user: '', allowedDomains: [], allowExternal: false,
  });
  expect(transportOptions(cfg)).not.toHaveProperty('auth');
});

test('SMTP settings and credentials come from the environment', () => {
  const cfg = emailConfig({
    EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.org', SMTP_PORT: '465', SMTP_SECURE: 'true',
    SMTP_USER: 'mailer', SMTP_PASS: 'from-env', EMAIL_FROM: 'SHMS <shms@example.org>', APP_URL: 'https://shms.example.org/',
    EMAIL_ALLOWED_DOMAINS: ' Example.org , shms.example ',
  });
  expect(cfg).toMatchObject({
    enabled: true, port: 465, secure: true, from: 'SHMS <shms@example.org>', appUrl: 'https://shms.example.org',
    allowedDomains: ['example.org', 'shms.example'],
  });
  expect(transportOptions(cfg)).toMatchObject({ host: 'smtp.example.org', port: 465, secure: true, auth: { user: 'mailer', pass: 'from-env' } });
});

describe('recipient domains', () => {
  const cfg = emailConfig({ EMAIL_ALLOWED_DOMAINS: 'shms.example' });

  test('an allowed domain passes, case-insensitively', () => {
    expect(refusalReason('Amina.Wekesa@SHMS.example', cfg)).toBeNull();
  });

  test('another domain, a look-alike subdomain or a malformed address is refused', () => {
    expect(refusalReason('someone@gmail.com', cfg)).toMatch(/not in EMAIL_ALLOWED_DOMAINS/);
    expect(refusalReason('a@shms.example.evil.com', cfg)).toMatch(/not in EMAIL_ALLOWED_DOMAINS/);
    expect(refusalReason('a@evilshms.example', cfg)).toMatch(/not in EMAIL_ALLOWED_DOMAINS/);
    expect(refusalReason('not-an-address', cfg)).toBe('not a valid email address');
    expect(refusalReason('', cfg)).toBe('not a valid email address');
  });

  test('with no allowed domains configured, nothing is allowed', () => {
    expect(refusalReason('a@shms.example', emailConfig({}))).toMatch(/not in EMAIL_ALLOWED_DOMAINS/);
  });

  test('EMAIL_ALLOW_EXTERNAL=true allows any valid address', () => {
    const open = emailConfig({ EMAIL_ALLOWED_DOMAINS: 'shms.example', EMAIL_ALLOW_EXTERNAL: 'true' });
    expect(refusalReason('someone@gmail.com', open)).toBeNull();
    expect(refusalReason('bad', open)).toBe('not a valid email address');
  });
});

describe('sendEmail', () => {
  const on = emailConfig({ EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'shms.example', EMAIL_FROM: 'SHMS <no-reply@shms.example>' });

  test('sends from EMAIL_FROM to an allowed address', async () => {
    const sent = capture();
    await sendEmail({ to: 'a@shms.example', subject: 'S', text: 'T' }, on);
    expect(sent).toEqual([{ from: 'SHMS <no-reply@shms.example>', to: 'a@shms.example', subject: 'S', text: 'T' }]);
  });

  test('refuses when disabled or when the domain is not allowed, without touching the transport', async () => {
    const sent = capture();
    await expect(sendEmail({ to: 'a@shms.example', subject: 'S', text: 'T' }, emailConfig({}))).rejects.toBeInstanceOf(EmailRefused);
    await expect(sendEmail({ to: 'a@gmail.com', subject: 'S', text: 'T' }, on)).rejects.toThrow(/refused: domain 'gmail.com'/);
    expect(sent).toEqual([]);
  });
});
