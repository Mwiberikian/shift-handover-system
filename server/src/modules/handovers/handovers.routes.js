const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./handovers.service');

const router = express.Router();
router.use(requireAuth);

const RECORD_STATUSES = ['draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed'];
const outgoingOnly = requireRole('outgoing_staff');
const recordId = param('id').isUUID().withMessage('id must be a UUID');

// ---- Phase 3 ---------------------------------------------------------------

router.get(
  '/',
  query('department_id').optional().isUUID(),
  query('status').optional().isIn(RECORD_STATUSES),
  validate,
  async (req, res) => res.json(await service.list(req.user, req.query)),
);

router.get('/meta', outgoingOnly, async (req, res) => res.json(await service.meta(req.user)));

router.post(
  '/',
  outgoingOnly,
  body('summary_notes').optional({ values: 'null' }).isString(),
  body('incoming_user_id').optional({ values: 'null' }).isUUID(),
  validate,
  async (req, res) => res.status(201).json(await service.create(req.user, req.body)),
);

router.patch(
  '/:id',
  outgoingOnly,
  recordId,
  body('summary_notes').optional({ values: 'null' }).isString(),
  body('incoming_user_id').optional({ values: 'null' }).isUUID(),
  validate,
  async (req, res) => res.json(await service.update(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/tasks',
  outgoingOnly,
  recordId,
  body('description').isString().trim().notEmpty().withMessage('description is required'),
  body('priority').optional().isIn(['low', 'medium', 'high']),
  body('status').optional().isIn(['open', 'in_progress', 'resolved']),
  validate,
  async (req, res) => res.status(201).json(await service.addTask(req.user, req.params.id, req.body)),
);

router.patch(
  '/:id/tasks/:taskId',
  outgoingOnly,
  recordId,
  param('taskId').isUUID(),
  body('description').optional().isString().trim().notEmpty(),
  body('priority').optional().isIn(['low', 'medium', 'high']),
  body('status').optional().isIn(['open', 'in_progress', 'resolved']),
  validate,
  async (req, res) => res.json(await service.updateTask(req.user, req.params.id, req.params.taskId, req.body)),
);

router.post(
  '/:id/incidents',
  outgoingOnly,
  recordId,
  body('title').isString().withMessage('title is required').bail()
    .trim().notEmpty().withMessage('title is required')
    .isLength({ max: 160 }).withMessage('title must be at most 160 characters'),
  body('description').optional({ values: 'null' }).isString(),
  body('severity').isIn(['low', 'medium', 'high', 'critical']).withMessage('severity must be low, medium, high or critical'),
  body('occurred_at').isISO8601().withMessage('occurred_at must be an ISO-8601 timestamp'),
  validate,
  async (req, res) => res.status(201).json(await service.addIncident(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/submit',
  outgoingOnly,
  recordId,
  validate,
  async (req, res) => res.json(await service.submit(req.user, req.params.id)),
);

module.exports = router;
