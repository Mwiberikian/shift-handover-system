// Web Push subscriptions (Part R3), for the signed-in user's own devices.
//
//   GET    /api/push/config      { enabled, public_key }
//   POST   /api/push/subscribe   { endpoint, keys: { p256dh, auth } }
//   DELETE /api/push/subscribe   { endpoint }
//
// Subscribing is refused (503) while push is off. The endpoint is a push
// service URL that works as a capability, so it is never logged or audited;
// the audit row records the device's user agent only.
const express = require('express');
const { body } = require('express-validator');
const validate = require('../../../middleware/validate');
const { requireAuth } = require('../../../middleware/auth');
const AppError = require('../../../utils/AppError');
const { withTransaction } = require('../../../db/tx');
const { writeAudit } = require('../../../utils/audit');
const { pushConfig } = require('./push');

const router = express.Router();
router.use(requireAuth);

router.get('/config', (req, res) => {
  const cfg = pushConfig();
  res.json({ enabled: cfg.enabled, public_key: cfg.enabled ? cfg.publicKey : null });
});

const endpoint = body('endpoint', 'endpoint must be an https URL').isString().isLength({ max: 2048 })
  .isURL({ protocols: ['https'], require_protocol: true, require_tld: false });
const key = (name) => body(`keys.${name}`, `keys.${name} is required`).isString().isLength({ min: 1, max: 256 }).matches(/^[A-Za-z0-9_-]+=*$/);

router.post('/subscribe', endpoint, key('p256dh'), key('auth'), validate, async (req, res) => {
  if (!pushConfig().enabled) throw new AppError(503, 'Push notifications are not configured');
  const userAgent = (req.get('user-agent') || '').slice(0, 300) || null;
  const created = await withTransaction(async (client) => {
    // One device, one user: signing in as someone else on the same browser
    // moves its subscription to the new user.
    const { rows: [row] } = await client.query(
      `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent, failed_count = 0
       RETURNING id, (xmax = 0) AS inserted`,
      [req.user.user_id, req.body.endpoint, req.body.keys.p256dh, req.body.keys.auth, userAgent],
    );
    await writeAudit(client, {
      userId: req.user.user_id, entityType: 'push_subscription', entityId: row.id, action: 'push_subscribe', newValue: { user_agent: userAgent },
    });
    return row.inserted;
  });
  res.status(created ? 201 : 200).json({ subscribed: true });
});

router.delete('/subscribe', endpoint, validate, async (req, res) => {
  const removed = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'DELETE FROM push_subscription WHERE endpoint = $1 AND user_id = $2 RETURNING id, user_agent',
      [req.body.endpoint, req.user.user_id],
    );
    for (const row of rows) {
      await writeAudit(client, {
        userId: req.user.user_id, entityType: 'push_subscription', entityId: row.id, action: 'push_unsubscribe', previousValue: { user_agent: row.user_agent },
      });
    }
    return rows.length;
  });
  res.json({ subscribed: false, removed });
});

module.exports = router;
