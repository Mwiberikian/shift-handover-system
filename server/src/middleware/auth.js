const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const AppError = require('../utils/AppError');

// Verifies the bearer JWT and confirms the account is still active with the
// same role/department, so deactivation or reassignment takes effect
// immediately rather than at token expiry.
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'Missing bearer token');
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }

  const { rows: [user] } = await pool.query(
    'SELECT user_id, role, department_id, is_active FROM app_user WHERE user_id = $1',
    [claims.user_id],
  );
  if (!user || !user.is_active) {
    throw new AppError(401, 'Account is inactive or no longer exists');
  }
  if (user.role !== claims.role || user.department_id !== claims.department_id) {
    throw new AppError(401, 'Role or department changed; please log in again');
  }

  req.user = { user_id: user.user_id, role: user.role, department_id: user.department_id };
  next();
}

// Rejects (403) any caller whose role is not in the allowed list.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, `Role '${req.user.role}' may not perform this action`, { allowed_roles: roles });
    }
    next();
  };
}

// Department scoping: non-admins may only touch their own department. Callers
// get an explicit 403, never a silently filtered result.
function assertDepartmentAccess(user, departmentId) {
  if (user.role === 'admin') return;
  if (!departmentId || user.department_id !== departmentId) {
    throw new AppError(403, 'Resource belongs to another department');
  }
}

module.exports = { requireAuth, requireRole, assertDepartmentAccess };
