// Runs in every test worker before any module (incl. config/db) is loaded.
const { testDbUrl } = require('./testDbUrl');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDbUrl();
process.env.JWT_SECRET ||= 'test-secret';
process.env.JWT_EXPIRY ||= '30m';
