module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  // Git worktrees created under .claude/worktrees/ (or worktrees/) live
  // inside this repo's own directory tree, each with its own full copy of
  // tests/. Without this, testMatch picks up both copies and runs every
  // test twice against the same shared database.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/worktrees/', '/worktrees/'],
  forceExit: true,
  // These are integration tests against a real remote Supabase Postgres
  // instance, not a mock. Default 5000ms is too tight once several test
  // files open concurrent pools against the same pooler.
  testTimeout: 20000,
  // Each test file requires its own src/config/db.js pg.Pool. Running
  // suites in parallel workers opens several pools at once against the
  // Supabase Transaction Pooler's limited connection slots, which can
  // exhaust them and hang even unrelated connections (including the dev
  // server's). Running serially lets each suite's pool.end() release its
  // connections before the next suite opens its own.
  maxWorkers: 1
};
