const express = require('express');
const { query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const workflow = require('../handovers/workflow.service');

const router = express.Router();

// Supervisors see their own department; admins see all (or ?department_code=).
router.get(
  '/supervisor',
  requireAuth,
  requireRole('supervisor', 'admin'),
  query('department_id').optional().isUUID(),
  query('department_code').optional().isString(),
  validate,
  async (req, res) => res.json(await workflow.supervisorDashboard(req.user, req.query)),
);

module.exports = router;
