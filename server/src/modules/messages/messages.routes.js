// Messaging. Append-only: there are deliberately no edit or delete routes.
const express = require('express');
const {
  body, param, query, oneOf,
} = require('express-validator');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const AppError = require('../../utils/AppError');
const service = require('./messages.service');

const router = express.Router();
router.use(requireAuth);

// IR-04: page and page_size are checked here and bound as parameters in the
// service. page_size above the maximum is clamped, not refused; a page out of
// range is a 400 (it used to reach Postgres and fail as a 500).
const pageQuery = [
  query('page', `page must be a whole number from 1 to ${service.MAX_PAGE}`).optional().isInt({ min: 1, max: service.MAX_PAGE }).toInt(),
  query('page_size', 'page_size must be a whole number of at least 1').optional().isInt({ min: 1 }).toInt(),
];

// Per user, not per IP: 30 sends an hour by default. Rejected sends (4xx)
// don't count. The store is exported so tests can reset it.
const sendLimitStore = new MemoryStore();
const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.MESSAGE_RATE_LIMIT) || 30,
  keyGenerator: (req) => req.user.user_id,
  skipFailedRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: sendLimitStore,
  handler: (req, res, next) => next(new AppError(429, 'You have sent too many messages. Please wait before sending more.')),
});

// Sends that also email (send_as 'email' or 'both'; supervisors and admins
// only) have their own, lower limit: 10 an hour per user by default.
const emailSendLimitStore = new MemoryStore();
const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.MESSAGE_EMAIL_RATE_LIMIT) || 10,
  keyGenerator: (req) => req.user.user_id,
  skip: (req) => !['email', 'both'].includes(req.body?.send_as),
  skipFailedRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: emailSendLimitStore,
  handler: (req, res, next) => next(new AppError(429, 'You have sent too many email messages. Please wait before sending more, or send as a system notification.')),
});

router.get('/inbox', pageQuery, validate, async (req, res) => res.json(await service.inbox(req.user, req.query)));
router.get('/sent', pageQuery, validate, async (req, res) => res.json(await service.sent(req.user, req.query)));
router.get('/unread-count', async (req, res) => res.json(await service.unreadCount(req.user)));

router.post(
  '/',
  sendLimiter,
  emailSendLimiter,
  body('recipient_type', 'recipient_type must be user, department or organisation').isIn(['user', 'department', 'organisation']),
  oneOf([
    [body('recipient_type').equals('user'), body('recipient_user_id', 'recipient_user_id must be a user id').isUUID()],
    [body('recipient_type').equals('department'), body('recipient_department_id', 'recipient_department_id must be a department id').isUUID()],
    body('recipient_type').equals('organisation'),
  ], { message: 'Choose a recipient for this message type' }),
  body('subject', 'Subject must be at most 160 characters').optional({ values: 'falsy' }).isString().trim().isLength({ max: 160 }),
  body('body', 'Message must be 1 to 2000 characters').isString().trim().isLength({ min: 1, max: 2000 }),
  body('send_as', "send_as must be 'notification', 'email' or 'both'").optional().isIn(['notification', 'email', 'both']),
  validate,
  async (req, res) => res.status(201).json(await service.send(req.user, req.body)),
);

const messageId = param('id', 'id must be a UUID').isUUID();
router.get('/:id', messageId, validate, async (req, res) => res.json(await service.getVisible(req.user, req.params.id)));
router.post('/:id/read', messageId, validate, async (req, res) => res.json(await service.markRead(req.user, req.params.id)));

module.exports = router;
module.exports.sendLimitStore = sendLimitStore;
module.exports.emailSendLimitStore = emailSendLimitStore;

// GET /api/directory — active users with minimal fields, for the recipient picker.
const directory = express.Router();
directory.use(requireAuth);
directory.get('/', async (req, res) => res.json(await service.directory()));
directory.get('/departments', async (req, res) => res.json(await service.departments()));
module.exports.directory = directory;
