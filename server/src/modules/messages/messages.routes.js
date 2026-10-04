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

const pageQuery = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('page_size').optional().isInt({ min: 1, max: 50 }).toInt(),
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

router.get('/inbox', pageQuery, validate, async (req, res) => res.json(await service.inbox(req.user, req.query)));
router.get('/sent', pageQuery, validate, async (req, res) => res.json(await service.sent(req.user, req.query)));
router.get('/unread-count', async (req, res) => res.json(await service.unreadCount(req.user)));

router.post(
  '/',
  sendLimiter,
  body('recipient_type', 'recipient_type must be user, department or organisation').isIn(['user', 'department', 'organisation']),
  oneOf([
    [body('recipient_type').equals('user'), body('recipient_user_id', 'recipient_user_id must be a user id').isUUID()],
    [body('recipient_type').equals('department'), body('recipient_department_id', 'recipient_department_id must be a department id').isUUID()],
    body('recipient_type').equals('organisation'),
  ], { message: 'Choose a recipient for this message type' }),
  body('subject', 'Subject must be at most 160 characters').optional({ values: 'falsy' }).isString().trim().isLength({ max: 160 }),
  body('body', 'Message must be 1 to 2000 characters').isString().trim().isLength({ min: 1, max: 2000 }),
  validate,
  async (req, res) => res.status(201).json(await service.send(req.user, req.body)),
);

const messageId = param('id', 'id must be a UUID').isUUID();
router.get('/:id', messageId, validate, async (req, res) => res.json(await service.getVisible(req.user, req.params.id)));
router.post('/:id/read', messageId, validate, async (req, res) => res.json(await service.markRead(req.user, req.params.id)));

module.exports = router;
module.exports.sendLimitStore = sendLimitStore;

// GET /api/directory — active users with minimal fields, for the recipient picker.
const directory = express.Router();
directory.use(requireAuth);
directory.get('/', async (req, res) => res.json(await service.directory()));
directory.get('/departments', async (req, res) => res.json(await service.departments()));
module.exports.directory = directory;
