// Integration test config. Runs ONLY tests under tests/integration.
// These hit a deployed staging stack (STAGE_API_URL) and obtain a real
// Cognito token, so they NEVER run as part of `npm test`. CI invokes
// them via `npm run test:integration` after a successful staging deploy.
export default {
  transform: {
    '^.+\\.[tj]sx?$': 'babel-jest',
    '^.+\\.mjs$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@aws-sdk))'
  ],
  roots: ['<rootDir>/tests/integration'],
  testMatch: [
    '**/?(*.)+(spec|test).mjs'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.aws-sam/'
  ],
  testEnvironment: 'node',
  // Network round-trips to API Gateway + Cognito; give them headroom.
  testTimeout: 30000
};
