// Unit test config for the Alexa skill. babel-jest transforms the ESM
// `.mjs` sources so handlers, the API client, and speech rendering can be
// imported and mocked in tests. No network or AWS access — the API client
// (global fetch) is mocked per test.
export default {
  transform: {
    "^.+\\.mjs$": "babel-jest",
  },
  roots: ["<rootDir>/tests"],
  testMatch: ["**/?(*.)+(spec|test).mjs"],
  moduleFileExtensions: ["mjs", "js", "json"],
  testEnvironment: "node",
};
