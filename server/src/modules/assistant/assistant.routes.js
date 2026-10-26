// /api/assistant: advisory features (Part S). Switch off with ASSISTANT_ENABLED=false.
const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./assistant.service');
const { EVENT_KINDS, SEARCH } = require('./constants');

const router = express.Router();
router.use(requireAuth);

// Always answers, so the client knows whether to show the assistant at all.
router.get('/config', (req, res) => res.json({ enabled: service.enabled() }));

router.use((req, res, next) => (service.enabled() ? next() : res.status(404).json({ error: 'Not found' })));

const author = requireRole('outgoing_staff');
const overseer = requireRole('supervisor', 'admin');
const recordId = param('id', 'id must be a UUID').isUUID();
const deptQuery = query('department_id', 'department_id must be a UUID').optional().isUUID();

// For a draft (outgoing staff, own records)
router.get('/handovers/:id/check', author, recordId, validate, async (req, res) => res.json(await service.check(req.user, req.params.id)));
router.get('/handovers/:id/recurring', author, recordId, validate, async (req, res) => res.json(await service.recurringForRecord(req.user, req.params.id)));
router.get('/handovers/:id/suggestions', author, recordId, validate, async (req, res) => res.json(await service.suggestions(req.user, req.params.id)));
router.post(
  '/severity',
  author,
  body('title').isString().trim().notEmpty().isLength({ max: 160 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 5000 }),
  validate,
  async (req, res) => res.json(await service.suggestSeverity(req.user, req.body)),
);

// For supervisors and admins
router.get('/attention', overseer, deptQuery, query('limit').optional().isInt({ min: 1, max: 50 }), validate, async (req, res) => res.json(await service.attention(req.user, req.query)));
router.get('/recurring', overseer, deptQuery, query('days').optional().isInt({ min: 1, max: 180 }), validate, async (req, res) => res.json(await service.recurringForDepartments(req.user, req.query)));
router.get(
  '/search',
  overseer,
  deptQuery,
  query('q', 'q is required (2 to 200 characters)').isString().trim().isLength({ min: 2, max: 200 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validate,
  async (req, res) => res.json(await service.search(req.user, { ...req.query, limit: req.query.limit || SEARCH.limit })),
);
router.get(
  '/digest',
  overseer,
  deptQuery,
  query('shift_id', 'shift_id must be a UUID').optional().isUUID(),
  validate,
  async (req, res) => res.json(await service.digest(req.user, req.query)),
);
router.get('/stats', overseer, deptQuery, query('days').optional().isInt({ min: 1, max: 365 }), validate, async (req, res) => res.json(await service.stats(req.user, req.query)));
router.get('/severity/evaluation', overseer, deptQuery, validate, async (req, res) => res.json(await service.severityEvaluation(req.user, req.query)));

// Anyone who uses the assistant may log what they did with it.
router.post(
  '/events',
  requireRole('outgoing_staff', 'supervisor', 'admin'),
  body('kind').isIn(EVENT_KINDS),
  body('record_id').optional({ values: 'null' }).isUUID(),
  body('payload').optional({ values: 'null' }).isObject(),
  validate,
  async (req, res) => res.status(201).json(await service.logEvent(req.user, req.body)),
);

module.exports = router;
