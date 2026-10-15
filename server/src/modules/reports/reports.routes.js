// Shift reports (/api/reports, Part L2). Any signed-in user may write and
// share their own reports; what each caller may see and share is decided in
// the service (see the rules at the top of reports.service.js).
const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { REPORT_TEXT, REPORT_TITLE_MAX } = require('../../config/constants');
const service = require('./reports.service');

const router = express.Router();
router.use(requireAuth);

const MAX_PAGE = 10000;
const MAX_SHARE = 50;
const MAX_LINKED_TASKS = 200;

const reportId = param('id', 'id must be a UUID').isUUID();

// Filters shared by the list (and the CSV export in L3).
const listQuery = [
  query('scope', 'scope must be mine, shared or department').optional().isIn(['mine', 'shared', 'department']),
  query('status', 'status must be draft or submitted').optional().isIn(['draft', 'submitted']),
  query('from', 'from must be an ISO 8601 date or time').optional().isISO8601(),
  query('to', 'to must be an ISO 8601 date or time').optional().isISO8601(),
  query('author_id', 'author_id must be a UUID').optional().isUUID(),
  query('shift_id', 'shift_id must be a UUID').optional().isUUID(),
  query('department_id', 'department_id must be a UUID').optional().isUUID(),
  query('page', `page must be a whole number from 1 to ${MAX_PAGE}`).optional().isInt({ min: 1, max: MAX_PAGE }).toInt(),
  // Above 100 is clamped to 100 in the service, not refused.
  query('page_size', 'page_size must be a whole number of at least 1').optional().isInt({ min: 1 }).toInt(),
];

// Drafts may be incomplete; the full rule (10 to 5000 characters after
// trimming, pending text unless "nothing pending") is checked on submit.
const draftBody = [
  body('title', `title must be text of at most ${REPORT_TITLE_MAX} characters`).optional().isString().isLength({ max: REPORT_TITLE_MAX }),
  body('done_text', `done_text must be text of at most ${REPORT_TEXT.max} characters`).optional().isString().isLength({ max: REPORT_TEXT.max }),
  body('pending_text', `pending_text must be text of at most ${REPORT_TEXT.max} characters`).optional().isString().isLength({ max: REPORT_TEXT.max }),
  body('nothing_pending', 'nothing_pending must be true or false').optional().isBoolean({ strict: true }),
  body('task_ids', `task_ids must be a list of at most ${MAX_LINKED_TASKS} task ids`).optional().isArray({ max: MAX_LINKED_TASKS }),
  body('task_ids.*', 'each task id must be a UUID').isUUID(),
];

const shareBody = [
  body('user_ids', `user_ids must list 1 to ${MAX_SHARE} users`).isArray({ min: 1, max: MAX_SHARE }),
  body('user_ids.*', 'each user id must be a UUID').isUUID(),
  body('email', 'email must be true or false').optional().isBoolean({ strict: true }),
];

// Who the caller may share with (the recipient picker).
router.get('/share-candidates', async (req, res) => res.json(await service.shareCandidates(req.user)));

router.get('/', listQuery, validate, async (req, res) => res.json(await service.list(req.user, req.query)));

// A new draft, prefilled from the caller's work session (or their current
// shift). A second call on the same shift returns the open draft (200).
router.post('/', async (req, res) => {
  const result = await service.create(req.user);
  res.status(result.created ? 201 : 200).json(result);
});

router.get('/:id', reportId, validate, async (req, res) => res.json(await service.get(req.user, req.params.id)));
router.patch('/:id', reportId, draftBody, validate, async (req, res) => res.json(await service.update(req.user, req.params.id, req.body)));
router.post('/:id/submit', reportId, validate, async (req, res) => res.json(await service.submit(req.user, req.params.id)));
router.post('/:id/share', reportId, shareBody, validate, async (req, res) => res.json(await service.share(req.user, req.params.id, req.body)));

module.exports = router;
module.exports.listQuery = listQuery;
