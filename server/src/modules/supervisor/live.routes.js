// Supervisor live board (/api/supervisor/live). Supervisors (own department)
// and admins (any department) only.
const express = require('express');
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./live.service');

const router = express.Router();
router.use(requireAuth, requireRole('supervisor', 'admin'));

router.get(
  '/live',
  query('department_id', 'department_id must be a UUID').optional().isUUID(),
  validate,
  async (req, res) => res.json(await service.board(req.user, req.query)),
);

router.get(
  '/live/:userId',
  param('userId', 'userId must be a UUID').isUUID(),
  validate,
  async (req, res) => res.json(await service.workerDetail(req.user, req.params.userId)),
);

module.exports = router;
