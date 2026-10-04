const express = require('express');
const { param } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications — the caller's own notifications, newest first.
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT n.*, d.code AS department_code, r.status AS record_status,
            ms.full_name AS message_sender_name, m.subject AS message_subject
       FROM notification n
       LEFT JOIN handover_record r ON r.record_id = n.record_id
       LEFT JOIN department d ON d.department_id = r.department_id
       LEFT JOIN message m ON m.message_id = n.message_id
       LEFT JOIN app_user ms ON ms.user_id = m.sender_id
      WHERE n.recipient_id = $1
      ORDER BY n.sent_at DESC LIMIT 100`,
    [req.user.user_id],
  );
  res.json(rows);
});

// POST /api/notifications/:id/read — mark one of the caller's notifications read.
router.post('/:id/read', param('id').isUUID(), validate, async (req, res) => {
  const { rows: [n] } = await pool.query(
    `UPDATE notification SET read_at = COALESCE(read_at, now())
      WHERE notification_id = $1 AND recipient_id = $2 RETURNING *`,
    [req.params.id, req.user.user_id],
  );
  if (!n) throw new AppError(404, 'Notification not found');
  res.json(n);
});

module.exports = router;
