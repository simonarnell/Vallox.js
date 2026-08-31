/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': '<rootDir>/jest.strip-types-transformer.cjs',
  },
  testMatch: ['**/__tests__/hardware/**/*.test.ts'],
  testEnvironment: 'node',
  // Real WS round-trips to embedded hardware are much slower than the mock
  // server, and the unit's own web server can't handle concurrent
  // connections (see WebSocketTransport's cache-stampede doc comment) — run
  // serially with a generous per-test timeout.
  testTimeout: 30_000,
  maxWorkers: 1,
  // Always collect coverage here (rather than requiring --coverage) — its
  // only real consumer is scripts/report-test-coverage.mjs, which needs the
  // real per-function hit data every time this config runs. Separate
  // directory from jest.config.js's mock run so neither overwrites the
  // other.
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**', '!src/cli.ts'],
  coverageDirectory: 'coverage-hardware',
  coverageReporters: ['json'],
}

export default config
