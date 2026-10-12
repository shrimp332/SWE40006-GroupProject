/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  globalSetup: "./test-helpers/global-setup.ts",
  setupFilesAfterEnv: ["./test-helpers/after-global-setup.ts"],
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  maxWorkers: 1,
};
