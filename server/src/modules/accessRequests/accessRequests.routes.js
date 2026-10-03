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
  body('full_name').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('full_name is required (max 120)'),
  body('email').isString().trim().isEmail().isLength({ max: 160 }).withMessage('a valid email is required'),
  body('staff_number').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }).withMessage('staff_number must be at most 20 characters'),
  body('requested_department_code').isString().trim().notEmpty().isLength({ max: 10 }).withMessage('requested_department_code is required'),
  body('note').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }).withMessage('note must be at most 1000 characters'),
  validate,
  async (req, res) => res.status(201).json(await service.submit(req.body)),
);

module.exports = router;
module.exports.submitLimitStore = submitLimitStore;
