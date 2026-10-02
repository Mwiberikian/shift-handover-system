const express = require('express');
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const pool = require('../../config/db');
const authService = require('./auth.service');

const router = express.Router();

// POST /api/auth/login  { staff_number | email | identifier, password }
router.post(
  '/login',
  body('password').isString().notEmpty().withMessage('password is required'),
  body().custom((b) => {
    if (!(b && (b.identifier || b.staff_number || b.email))) throw new Error('staff_number or email is required');
    return true;
  }),
  validate,
  async (req, res) => {
    const identifier = String(req.body.identifier || req.body.staff_number || req.body.email).trim();
    res.json(await authService.login(identifier, req.body.password));
  },
);

// GET /api/auth/me — current profile (used by the client on page reload).
router.get('/me', requireAuth, async (req, res) => {
  const { rows: [me] } = await pool.query(
    `SELECT u.user_id, u.staff_number, u.full_name, u.email, u.role, u.department_id,
            d.code AS department_code, d.name AS department_name
       FROM app_user u LEFT JOIN department d USING (department_id) WHERE u.user_id = $1`,
    [req.user.user_id],
  );
  res.json(me);
});

module.exports = router;
