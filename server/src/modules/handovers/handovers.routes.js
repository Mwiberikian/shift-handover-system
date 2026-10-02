const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./handovers.service');
const workflow = require('./workflow.service');

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

// Declared before '/:id' so 'search' isn't captured as an id.
router.get(
  '/search',
  requireRole('supervisor', 'admin'),
  query('from').optional().isISO8601().withMessage('from must be an ISO-8601 date'),
  query('to').optional().isISO8601().withMessage('to must be an ISO-8601 date'),
  query('department_id').optional().isUUID(),
  query('department_code').optional().isString(),
  query('status').optional().isIn(RECORD_STATUSES),
  query('q').optional().isString().trim(),
  validate,
  async (req, res) => res.json(await workflow.search(req.user, req.query)),
);

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

// ---- Phase 4 ---------------------------------------------------------------

const incomingOnly = requireRole('incoming_staff');
const supervisorOnly = requireRole('supervisor');
const optionalComments = body('comments').optional({ values: 'null' }).isString().trim();
const requiredComments = (what) => body('comments').isString().withMessage(`comments (${what}) are required`).bail()
  .trim().notEmpty().withMessage(`comments (${what}) are required`);

router.get('/:id', recordId, validate, async (req, res) => res.json(await workflow.getById(req.user, req.params.id)));

router.post(
  '/:id/acknowledgement',
  incomingOnly,
  recordId,
  optionalComments,
  validate,
  async (req, res) => res.json(await workflow.acknowledge(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/query',
  incomingOnly,
  recordId,
  requiredComments('the query'),
  validate,
  async (req, res) => res.json(await workflow.raiseQuery(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/clarify',
  outgoingOnly,
  recordId,
  requiredComments('the clarification'),
  validate,
  async (req, res) => res.json(await workflow.clarify(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/review',
  supervisorOnly,
  recordId,
  body('decision').isIn(['approved', 'escalated']).withMessage("decision must be 'approved' or 'escalated'"),
  optionalComments,
  validate,
  async (req, res) => res.json(await workflow.review(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/resolve',
  supervisorOnly,
  recordId,
  optionalComments,
  validate,
  async (req, res) => res.json(await workflow.resolve(req.user, req.params.id, req.body)),
);

module.exports = router;
