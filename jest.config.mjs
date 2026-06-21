// Unit test config. Runs ONLY tests under tests/unit so `npm test`
// never touches the integration harness (which needs a deployed
// staging stack and AWS credentials).
export default {
  transform: {
    '^.+\\.[tj]sx?$': 'babel-jest',
    '^.+\\.mjs$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@aws-sdk))'
  ],
  roots: ['<rootDir>/tests/unit'],
  testMatch: [
    '**/?(*.)+(spec|test).mjs'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.aws-sam/'
  ],
  testEnvironment: 'node'
};
