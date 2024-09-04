module.exports = {
  preset: 'ts-jest',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  collectCoverage: true,
  coverageReporters: ['json', 'json-summary', 'cobertura', 'text', 'html', 'clover'],
  coverageDirectory: './private/coverage',
  coverageThreshold: {
    global: {
      branches: 70,
      statements: 80,
    },
  },
  testEnvironment: 'node',
};
