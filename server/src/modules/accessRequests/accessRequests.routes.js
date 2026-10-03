// Public (unauthenticated) access-request endpoints. Admin review lives in
// admin.routes so it sits behind the admin router's auth + role guard.
const express = require('express');
const { body } = require('express-validator');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const validate = require('../../middleware/validate');
const AppError = require('../../utils/AppError');
const service = require('./accessRequests.service');

const router = express.Router();

// Unauthenticated writes are rate-limited per IP. The store is exported so
// tests can reset it between cases.
const submitLimitStore = new MemoryStore();
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.ACCESS_REQUEST_RATE_LIMIT) || 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: submitLimitStore,
  handler: (req, res, next) => next(new AppError(429, 'Too many access requests from this network. Please try again later.')),
});

router.get('/departments', async (req, res) => res.json(await service.listRequestableDepartments()));

router.post(
  '/',
  submitLimiter,
  // body(field, message) applies the message to every check in the chain.
  body('full_name', 'Enter your full name (up to 120 characters)').isString().trim().notEmpty().isLength({ max: 120 }),
  body('email', 'Enter a valid work email address').isString().trim().isEmail().isLength({ max: 160 }),
  body('staff_number', 'Staff number must be at most 20 characters').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  body('requested_department_code', 'Select your department').isString().trim().notEmpty().isLength({ max: 10 }),
  body('note', 'Note must be at most 1000 characters').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
  validate,
  async (req, res) => res.status(201).json(await service.submit(req.body)),
);

module.exports = router;
module.exports.submitLimitStore = submitLimitStore;
