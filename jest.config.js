module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  forceExit: true,
  // These are integration tests against a real remote Supabase Postgres
  // instance, not a mock. Default 5000ms is too tight once several test
  // files open concurrent pools against the same pooler.
  testTimeout: 20000
};
