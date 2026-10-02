const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireAuth, requireRole } = require('../../middleware/auth');
const service = require('./admin.service');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ROLES = ['outgoing_staff', 'incoming_staff', 'supervisor', 'admin'];
const userId = param('id').isUUID().withMessage('id must be a UUID');
const password = (chain) => chain.isString().isLength({ min: 8 }).withMessage('password must be at least 8 characters');

// ---- Users -----------------------------------------------------------------

router.get(
  '/users',
  query('department_id').optional().isUUID(),
  query('role').optional().isIn(ROLES),
  query('is_active').optional().isIn(['true', 'false']),
  validate,
  async (req, res) => res.json(await service.listUsers(req.query)),
);

router.get('/users/:id', userId, validate, async (req, res) => res.json(await service.getUser(req.params.id)));

router.post(
  '/users',
  body('staff_number').isString().trim().notEmpty().isLength({ max: 20 }).withMessage('staff_number is required (max 20)'),
  body('full_name').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('full_name is required (max 120)'),
  body('email').isEmail().isLength({ max: 160 }).withMessage('a valid email is required'),
  password(body('password')),
  body('role').isIn(ROLES).withMessage(`role must be one of ${ROLES.join(', ')}`),
  body('department_id').optional({ values: 'null' }).isUUID(),
  body('is_active').optional().isBoolean({ strict: true }),
  validate,
  async (req, res) => res.status(201).json(await service.createUser(req.user, req.body)),
);

router.patch(
  '/users/:id',
  userId,
  body('full_name').optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body('email').optional().isEmail().isLength({ max: 160 }),
  password(body('password').optional()),
  body('role').optional().isIn(ROLES),
  body('department_id').optional({ values: 'null' }).isUUID(),
  body('is_active').optional().isBoolean({ strict: true }),
  body('staff_number').not().exists().withMessage('staff_number cannot be changed'),
  validate,
  async (req, res) => res.json(await service.updateUser(req.user, req.params.id, req.body)),
);

// Soft delete: deactivates the account (history is never removed).
router.delete('/users/:id', userId, validate, async (req, res) => res.json(await service.deactivateUser(req.user, req.params.id)));

// ---- Departments & templates ----------------------------------------------

router.get('/departments', async (req, res) => res.json(await service.listDepartments()));

router.get(
  '/templates/:departmentCode',
  query('version').optional().isInt({ min: 1 }),
  validate,
  async (req, res) => res.json(await service.getTemplate(req.params.departmentCode, req.query.version)),
);

router.put(
  '/templates/:departmentCode',
  body('field_definition').isObject().withMessage('field_definition must be an object'),
  validate,
  async (req, res) => {
    const result = await service.updateTemplate(req.user, req.params.departmentCode, req.body.field_definition);
    res.status(result.changed ? 201 : 200).json(result);
  },
);

module.exports = router;
