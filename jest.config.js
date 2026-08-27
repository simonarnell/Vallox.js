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
  testEnvironment: 'node',
}

export default config
