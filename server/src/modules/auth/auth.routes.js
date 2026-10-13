const express = require('express');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { requireAuth, requireAuthForPasswordChange } = require('../../middleware/auth');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const AppError = require('../../utils/AppError');
const pool = require('../../config/db');
const authService = require('./auth.service');

const router = express.Router();

// POST /api/auth/login  { staff_number | email | identifier, password }
router.post(
  '/login',
  body('password').isString().notEmpty().withMessage('password is required'),
  body().custom((b) => {
    if (!(b && (b.identifier || b.staff_number || b.email))) throw new Error('staff_number or email is required');
    return true;
  }),
  validate,
  async (req, res) => {
    const identifier = String(req.body.identifier || req.body.staff_number || req.body.email).trim();
    res.json(await authService.login(identifier, req.body.password));
  },
);

// ---- Google sign-in (all return 503 when GOOGLE_CLIENT_ID is unset) --------

const credential = body('credential', 'credential is required').isString().notEmpty().isLength({ max: 4096 });

// GET /api/auth/google/config — the public OAuth client id the browser needs.
router.get('/google/config', (req, res) => res.json(authService.googleConfig()));

// POST /api/auth/google { credential } — sign in to an existing account.
// No match returns 404 { code: 'no_account', name, email } and no token.
router.post('/google', credential, validate, async (req, res) => {
  const result = await authService.googleSignIn(req.body.credential);
  if (result.no_account) {
    return res.status(404).json({
      error: 'No account is linked to this Google address', code: 'no_account', name: result.name, email: result.email,
    });
  }
  return res.json(result);
});

// POST /api/auth/google/profile { credential } — verified name and email only,
// to prefill the access-request form. Never signs in.
router.post('/google/profile', credential, validate, async (req, res) => res.json(await authService.googleProfile(req.body.credential)));

// GET /api/auth/me — current profile (used by the client on page reload).
// Allowed while a temporary password is still in use.
router.get('/me', requireAuthForPasswordChange, async (req, res) => {
  const { rows: [me] } = await pool.query(
    `SELECT u.user_id, u.staff_number, u.full_name, u.email, u.role, u.department_id, u.must_change_password,
            u.email_notifications,
            d.code AS department_code, d.name AS department_name
       FROM app_user u LEFT JOIN department d USING (department_id) WHERE u.user_id = $1`,
    [req.user.user_id],
  );
  res.json(me);
});

// PATCH /api/auth/me/preferences { email_notifications } — the caller's own
// switch for email alerts (in-app notifications are unaffected). Audited.
router.patch(
  '/me/preferences',
  requireAuth,
  body('email_notifications', 'email_notifications must be true or false').isBoolean({ strict: true }),
  validate,
  async (req, res) => {
    const result = await withTransaction(async (client) => {
      const { rows: [before] } = await client.query(
        'SELECT email_notifications FROM app_user WHERE user_id = $1 FOR UPDATE', [req.user.user_id],
      );
      const { rows: [after] } = await client.query(
        'UPDATE app_user SET email_notifications = $2 WHERE user_id = $1 RETURNING email_notifications',
        [req.user.user_id, req.body.email_notifications],
      );
      if (before.email_notifications !== after.email_notifications) {
        await writeAudit(client, {
          userId: req.user.user_id, entityType: 'app_user', entityId: req.user.user_id, action: 'update_preferences',
          previousValue: before, newValue: after,
        });
      }
      return after;
    });
    res.json(result);
  },
);

// Calendar subscription feed (Part K): status, create/regenerate (the URL is
// returned once), revoke. The token itself is never stored or logged.
const calendarFeed = require('../shifts/calendarFeed');

const feedUrl = (req, token) => `${req.protocol}://${req.get('host')}/api/shifts/calendar/${token}.ics`;

router.get('/me/calendar-feed', requireAuth, async (req, res) => res.json(await calendarFeed.status(req.user.user_id)));

router.post('/me/calendar-feed', requireAuth, async (req, res) => {
  const { token, created_at: createdAt } = await calendarFeed.create(req.user.user_id);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ active: true, created_at: createdAt, url: feedUrl(req, token) });
});

router.delete('/me/calendar-feed', requireAuth, async (req, res) => res.json(await calendarFeed.revoke(req.user.user_id)));

// POST /api/auth/change-password { current_password, new_password } (NFR-05).
// 10 attempts per user per 15 minutes; the store is exported for tests.
const passwordChangeStore = new MemoryStore();
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user.user_id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: passwordChangeStore,
  handler: (req, res, next) => next(new AppError(429, 'Too many password change attempts. Please wait and try again.')),
});

router.post(
  '/change-password',
  requireAuthForPasswordChange,
  passwordChangeLimiter,
  body('current_password', 'current_password is required').isString().notEmpty(),
  // bcrypt reads at most 72 bytes; a longer password would be silently cut.
  body('new_password', 'new_password must be 10 to 72 characters').isString().isLength({ min: 10, max: 72 }),
  body('new_password', 'new_password is longer than 72 bytes').custom((v) => typeof v !== 'string' || Buffer.byteLength(v) <= 72),
  validate,
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await authService.changePassword(req.user.user_id, req.body.current_password, req.body.new_password));
  },
);

module.exports = router;
module.exports.passwordChangeStore = passwordChangeStore;
