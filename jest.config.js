/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  setupFiles: ['reflect-metadata', '<rootDir>/test/jest.setup.ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@app/common(|/.*)$': '<rootDir>/libs/common/src$1',
  },
  collectCoverageFrom: ['libs/**/*.(t|j)s', 'apps/**/*.(t|j)s'],
  testEnvironment: 'node',
};
