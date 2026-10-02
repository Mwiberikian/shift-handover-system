module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  setupFiles: ['<rootDir>/tests/helpers/setupEnv.js'],
  testTimeout: 30000,
};
