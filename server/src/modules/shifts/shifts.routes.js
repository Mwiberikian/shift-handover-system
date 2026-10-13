const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./shifts.service');
const ics = require('../../utils/ics');

const router = express.Router();
router.use(requireAuth);

// GET /api/shifts/mine — the caller's current and next rostered shift.
router.get('/mine', async (req, res) => res.json(await service.mine(req.user)));

// GET /api/shifts/mine/upcoming?days=30 — the caller's rostered shifts that
// have not ended, for the My shifts page.
router.get(
  '/mine/upcoming',
  query('days', 'days must be 1 to 90').optional().isInt({ min: 1, max: 90 }).toInt(),
  validate,
  async (req, res) => res.json(await service.upcomingMine(req.user.user_id, req.query.days || 30)),
);

// GET /api/shifts/calendar.ics?shift_id= | ?days=30&scope=mine|department
// An iCalendar file to import (Download .ics). Name, times and department only.
router.get(
  '/calendar.ics',
  query('shift_id', 'shift_id must be a UUID').optional().isUUID(),
  query('days', 'days must be 1 to 90').optional().isInt({ min: 1, max: 90 }).toInt(),
  query('scope', "scope must be 'mine' or 'department'").optional().isIn(['mine', 'department']),
  validate,
  async (req, res) => {
    const shifts = await service.calendarShifts(req.user, req.query);
    const one = Boolean(req.query.shift_id);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.attachment(one ? `shift-${req.query.shift_id.slice(0, 8)}.ics` : `shifts-next-${req.query.days || 30}-days.ics`);
    res.send(ics.calendar(shifts, { name: one ? 'Shift Handover shift' : 'Shift Handover shifts' }));
  },
);

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
