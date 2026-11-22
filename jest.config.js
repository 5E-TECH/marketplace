/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  setupFiles: ['reflect-metadata', '<rootDir>/test/jest.setup.ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    // BE-08: haqiqiy `minio` klienti (MinIO integratsion testi) → query-string → faqat ESM bo'lgan
    // decode-uri-component. Faqat shu paket JS dan o'giriladi (pastdagi transformIgnorePatterns).
    '^.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true }, isolatedModules: true },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!decode-uri-component/)'],
  moduleNameMapper: {
    '^@app/common(|/.*)$': '<rootDir>/libs/common/src$1',
  },
  collectCoverageFrom: ['libs/**/*.(t|j)s', 'apps/**/*.(t|j)s'],
  testEnvironment: 'node',
};
