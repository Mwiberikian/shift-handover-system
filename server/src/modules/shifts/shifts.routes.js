const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./shifts.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/shifts/mine — the caller's current and next rostered shift.
router.get('/mine', async (req, res) => res.json(await service.mine(req.user)));

// Roster management: supervisors for their own department, admins for any.
const manager = requireRole('supervisor', 'admin');
const shiftId = param('id', 'id must be a UUID').isUUID();

router.get(
  '/',
  manager,
  query('department_id').optional().isUUID(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  validate,
  async (req, res) => res.json(await service.list(req.user, req.query)),
);

router.get('/:id/assignments', manager, shiftId, validate, async (req, res) => res.json(await service.getAssignments(req.user, req.params.id)));

router.put(
  '/:id/assignments',
  manager,
  shiftId,
  body('user_ids', 'user_ids must be an array of user ids').isArray({ max: 200 }),
  body('user_ids.*', 'user_ids must be an array of user ids').isUUID(),
  validate,
  async (req, res) => res.json(await service.setAssignments(req.user, req.params.id, req.body.user_ids)),
);

module.exports = router;
