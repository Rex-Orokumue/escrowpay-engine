module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Git worktrees created under .claude/worktrees/ (or worktrees/) live
  // inside this repo's own directory tree, each with its own full copy of
  // tests/. `roots` scopes discovery to this config's own tests/ folder
  // only, so it never crawls into a nested worktree's copy — unlike a
  // testPathIgnorePatterns blocklist, this also works correctly when the
  // cwd IS itself such a worktree (its own tests/ is still <rootDir>/tests).
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
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
