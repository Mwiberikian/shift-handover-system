// Supervisor controls (Phase 1, /api/supervisor). Supervisors (own
// department) and admins (any) start/end an employee's work session and
// switch an employee between the two staff duties.
//
// Behind SUPERVISOR_CONTROLS_ENABLED (default true): when false every route
// here answers 404, as if it did not exist, so the feature can be switched
// off on the host without a redeploy.
const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { supervisorControlsEnabled } = require('../../config/flags');
const service = require('./controls.service');

const router = express.Router();
router.use((req, res, next) => (supervisorControlsEnabled() ? next() : res.status(404).json({ error: 'Not found' })));
router.use(requireAuth, requireRole('supervisor', 'admin'));

const userId = param('userId', 'userId must be a UUID').isUUID();

router.post('/live/:userId/session/start', userId, validate, async (req, res) => {
  res.status(201).json(await service.startSession(req.user, req.params.userId));
});
router.post('/live/:userId/session/end', userId, validate, async (req, res) => res.json(await service.endSession(req.user, req.params.userId)));
router.post(
  '/users/:userId/role',
  userId,
  body('role', "role must be 'outgoing_staff' or 'incoming_staff'").isIn(['outgoing_staff', 'incoming_staff']),
  validate,
  async (req, res) => res.json(await service.switchRole(req.user, req.params.userId, req.body.role)),
);

module.exports = router;
