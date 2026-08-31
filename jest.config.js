/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Strip .js extensions from relative imports so the transform resolves .ts sources
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': '<rootDir>/jest.strip-types-transformer.cjs',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/hardware/'],
  testEnvironment: 'node',
  // cli.ts is excluded: it's genuinely tested (src/__tests__/cli.test.ts
  // spawns the built binary as a real subprocess), but Istanbul/V8 coverage
  // collection can't see code executed in a separate process, so it would
  // only ever show a false 0% here rather than no data at all.
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**', '!src/cli.ts'],
  coverageDirectory: 'coverage',
  // 'text' is captured verbatim by scripts/report-test-coverage.mjs;
  // 'json' writes coverage-final.json, whose real per-function hit counts
  // (fnMap/f) drive the report's mocked-vs-hardware method matrix.
  // 'html' writes the interactive file-tree/line-by-line report — explicit
  // subdir: 'lcov-report', since istanbul-reports' html reporter otherwise
  // defaults to writing straight into coverageDirectory (no subfolder at
  // all), which would collide with test-report.html and its own path
  // assumptions. Local viewing only, not published — see .npmignore.
  coverageReporters: ['text', 'json', ['html', { subdir: 'lcov-report' }]],
}

export default config
