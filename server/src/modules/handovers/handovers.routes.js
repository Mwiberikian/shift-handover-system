const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./handovers.service');
const workflow = require('./workflow.service');
const { TASK_DESCRIPTION } = require('../../config/constants');
const { logRejectedWrite } = require('../../utils/rejections');

const router = express.Router();
router.use(requireAuth);

const RECORD_STATUSES = ['draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed'];
const SHIFT_TYPES = ['day', 'night'];

// Phase 3: with roster duty on, outgoing_staff and incoming_staff are the
// same "staff" capability at the route; the services then decide from the
// roster (and fall back to the fixed role for shifts with no roster). With
// the flag off these gates behave exactly as before. Evaluated per request,
// so flipping the flag needs no restart.
const { rosterDutyEnabled } = require('../../config/flags');
const staffOr = (role) => (req, res, next) => requireRole(
  ...(rosterDutyEnabled() ? ['outgoing_staff', 'incoming_staff'] : [role]),
)(req, res, next);
const outgoingOnly = staffOr('outgoing_staff');
const recordId = param('id').isUUID().withMessage('id must be a UUID');

// DR-04: a task description is 10 to 1,000 characters (after trimming).
const DESCRIPTION_MESSAGE = `description must be ${TASK_DESCRIPTION.min} to ${TASK_DESCRIPTION.max} characters`;
const taskDescription = (chain) => chain.isString().withMessage(DESCRIPTION_MESSAGE).bail()
  .trim().isLength(TASK_DESCRIPTION).withMessage(DESCRIPTION_MESSAGE);

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
  query('shift_type', "shift_type must be 'day' or 'night'").optional().isIn(SHIFT_TYPES),
  query('shift_id', 'shift_id must be a UUID').optional().isUUID(),
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
  taskDescription(body('description')),
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
  taskDescription(body('description').optional()),
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

const incomingOnly = staffOr('incoming_staff');
const supervisorOnly = requireRole('supervisor');
const optionalComments = body('comments').optional({ values: 'null' }).isString().trim();
const requiredComments = (what) => body('comments').isString().withMessage(`comments (${what}) are required`).bail()
  .trim().notEmpty().withMessage(`comments (${what}) are required`);

router.get('/:id', recordId, validate, async (req, res) => res.json(await workflow.getById(req.user, req.params.id)));

// ?download=1 asks the browser to save it as a file.
router.get('/:id/export', recordId, query('download').optional().isIn(['0', '1']), validate, async (req, res) => {
  const data = await workflow.exportRecord(req.user, req.params.id);
  if (req.query.download === '1') {
    res.attachment(`handover-${req.params.id}.json`);
  }
  res.json(data);
});

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
  '/:id/open-review',
  requireRole('supervisor', 'admin'),
  recordId,
  validate,
  async (req, res) => res.json(await workflow.openReview(req.user, req.params.id)),
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

// ---- Phase 2: automatic release, with holds --------------------------------
// Supervisor (own department) or admin actions on a HELD report. Available
// whatever AUTO_APPROVAL_ENABLED says: approving is the safe path out of a
// hold, so it can never be switched off.
const release = require('./release.service');

router.post(
  '/:id/approve',
  requireRole('supervisor', 'admin'),
  recordId,
  optionalComments,
  validate,
  async (req, res) => res.json(await release.approve(req.user, req.params.id, req.body)),
);

router.post(
  '/:id/send-back',
  requireRole('supervisor', 'admin'),
  recordId,
  requiredComments('the reason for sending back'),
  validate,
  async (req, res) => res.json(await release.sendBack(req.user, req.params.id, req.body)),
);

// DR-12: rejected writes (400 validation, 422 incomplete submit) are audited.
router.use(logRejectedWrite);

module.exports = router;
