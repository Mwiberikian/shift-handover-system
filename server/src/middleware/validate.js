const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

// Runs after express-validator chains; returns 400 listing every failing field.
function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    throw new AppError(400, 'Validation failed', result.array().map((e) => ({ field: e.path, message: e.msg })));
  }
  next();
}

module.exports = validate;
