module.exports = {
  preset: "ts-jest",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testEnvironment: "node",
  moduleNameMapper: { "^@essentials/db$": "<rootDir>/../../../packages/db/index.ts" },
  setupFiles: ["<rootDir>/../jest.setup.js"],
};
