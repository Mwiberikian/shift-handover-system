// /api/auth/passkeys. When the WEBAUTHN_* variables are unset everything here
// answers 404, except GET /config, which is how the client knows to hide the UI.
const express = require('express');
const { body, param } = require('express-validator');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { webauthnConfig } = require('../../config/env');
const { requireAuth } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const AppError = require('../../utils/AppError');
const service = require('./passkeys.service');

const router = express.Router();

router.get('/config', (req, res) => res.json({ passkeys: Boolean(webauthnConfig()) }));

router.use((req, res, next) => {
  if (!webauthnConfig()) throw new AppError(404, 'Not found');
  res.set('Cache-Control', 'no-store');
  next();
});

// A sign-in takes two requests, so the default allows about 15 per 15 minutes
// from one address. The stores are exported for tests.
const limiterOptions = (store) => ({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PASSKEY_RATE_LIMIT) || 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store,
  handler: (req, res, next) => next(new AppError(429, 'Too many passkey attempts. Please wait and try again.')),
});
const loginLimitStore = new MemoryStore();
const manageLimitStore = new MemoryStore();
const loginLimiter = rateLimit(limiterOptions(loginLimitStore));
const manageLimiter = rateLimit({ ...limiterOptions(manageLimitStore), keyGenerator: (req) => req.user.user_id });

const signedIn = [requireAuth, manageLimiter];
const passkeyId = param('id', 'id must be a UUID').isUUID();
const label = (chain) => chain.isString().trim().notEmpty().isLength({ max: 60 });

// ---- Sign-in (public). Bad input gets the same generic failure as anything
// else, so these do not use the validate middleware. --------------------------

router.post('/login/options', loginLimiter, async (req, res) => res.json(await service.loginOptions()));
router.post('/login/verify', loginLimiter, async (req, res) => res.json(await service.verifyLogin(req.body ?? {})));

// ---- Registration and your own passkeys --------------------------------------

router.post('/register/options', signedIn, async (req, res) => res.json(await service.registrationOptions(req.user.user_id)));

router.post(
  '/register/verify',
  signedIn,
  body('challenge_id', 'challenge_id must be a UUID').isUUID(),
  body('response', 'response is required').isObject(),
  label(body('label', 'label must be up to 60 characters').optional()),
  validate,
  async (req, res) => res.status(201).json(await service.verifyRegistration(req.user.user_id, req.body)),
);

router.get('/', signedIn, async (req, res) => res.json(await service.list(req.user.user_id)));

router.patch(
  '/:id',
  signedIn,
  passkeyId,
  label(body('label', 'label is required (up to 60 characters)')),
  validate,
  async (req, res) => res.json(await service.rename(req.user.user_id, req.params.id, req.body.label)),
);

router.delete('/:id', signedIn, passkeyId, validate, async (req, res) => {
  await service.remove(req.user.user_id, req.params.id);
  res.status(204).end();
});

module.exports = router;
module.exports.loginLimitStore = loginLimitStore;
module.exports.manageLimitStore = manageLimitStore;
