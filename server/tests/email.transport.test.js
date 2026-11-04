// The SMTP transport forces IPv4 and fails fast. A host with no IPv6 route must
// never dial an AAAA address (connect ENETUNREACH 2a00:...:587 on Render).
const { EventEmitter } = require('events');
const net = require('net');
const nodemailer = require('nodemailer');
const { dnsCache } = require('nodemailer/lib/shared');
const {
  emailConfig, transportOptions, connectWithFamily, smtpStartupLine, getTransport, sendEmail, setTransport,
} = require('../src/modules/notifications/email/mailer');

afterEach(() => {
  setTransport(null);
  dnsCache.clear();
  jest.restoreAllMocks();
});

// A minimal SMTP server on 127.0.0.1 only. No IPv6 listener.
function fakeSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.on('error', () => {});
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (inData) {
        if (!buffer.endsWith('\r\n.\r\n')) return;
        messages.push(buffer);
        buffer = '';
        inData = false;
        socket.write('250 queued\r\n');
        return;
      }
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (/^(EHLO|HELO|MAIL|RCPT)/i.test(line)) socket.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 go\r\n'); } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('500 what\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      messages,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

const config = (port) => emailConfig({
  EMAIL_ENABLED: 'true', SMTP_HOST: 'localhost', SMTP_PORT: String(port), EMAIL_ALLOWED_DOMAINS: 'shms.example',
});
const message = { to: 'a@shms.example', subject: 'S', text: 'T' };

test('the transport is created with family 4 and timeouts of 10-15 seconds', () => {
  const create = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({});
  const cfg = emailConfig({ SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587' });
  setTransport(null);
  getTransport(cfg);
  expect(create).toHaveBeenCalledTimes(1);
  const options = create.mock.calls[0][0];
  expect(options).toEqual(transportOptions(cfg));
  expect(options.family).toBe(4);
  for (const name of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
    expect(options[name]).toBeGreaterThanOrEqual(10000);
    expect(options[name]).toBeLessThanOrEqual(15000);
  }
});

test('a real send dials IPv4 even when the resolver would return an IPv6 address', async () => {
  const server = await fakeSmtp();
  // What nodemailer's own resolver would hand back on the broken host. It must
  // not be used: 2001:db8::/32 is unroutable, so dialling it fails the send.
  dnsCache.set('localhost', {
    value: { addresses: ['2001:db8::1'], servername: 'localhost' }, expires: Date.now() + 60000,
  });
  const connect = jest.spyOn(net, 'connect');
  try {
    await sendEmail(message, config(server.port));
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'localhost', port: server.port, family: 4 }));
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain('Subject: S');
  } finally {
    await server.close();
  }
});

test('a refused connection reaches the caller with its error code', async () => {
  const server = await fakeSmtp();
  await server.close();
  await expect(sendEmail(message, config(server.port))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});

test('a connection that never opens fails with ETIMEDOUT and destroys the socket', async () => {
  const socket = Object.assign(new EventEmitter(), { destroy: jest.fn() });
  jest.spyOn(net, 'connect').mockReturnValue(socket);
  const err = await new Promise((resolve) => {
    connectWithFamily({ host: 'smtp.example.org', port: 587, family: 4, connectionTimeout: 10 }, resolve);
  });
  expect(err).toMatchObject({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT smtp.example.org:587' });
  expect(socket.destroy).toHaveBeenCalled();
  expect(socket.listenerCount('error')).toBe(0);
});

test('the start-up line says whether the host is set and never shows a setting', () => {
  expect(smtpStartupLine({})).toBe('SMTP configured: host set no.');
  const line = smtpStartupLine({ SMTP_HOST: 'smtp.example.org', SMTP_USER: 'mailer', SMTP_PASS: 'hunter2' });
  expect(line).toBe('SMTP configured: host set yes.');
});
