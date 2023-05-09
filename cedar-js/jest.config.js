/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  maxWorkers: 1, // work around bigint failures
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: './tsconfig.json' },
    ]
  },

};