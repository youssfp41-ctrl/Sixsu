/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          target:           "ES2020",
          module:           "commonjs",
          lib:              ["ES2020"],
          strict:           true,
          esModuleInterop:  true,
          skipLibCheck:     true,
          resolveJsonModule: true,
          noUnusedLocals:   false,
          noUnusedParameters: false,
        },
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  clearMocks: true,
  collectCoverageFrom: [
    "src/middleware/built-in/**/*.ts",
    "src/context/ContextBuilder.ts",
    "src/plugins/definitions/owner/index.ts",
  ],
  coverageReporters: ["text", "lcov"],
  verbose: true,
};
