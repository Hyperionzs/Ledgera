module.exports = {
  displayName: '@ledgera/backend',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ledgera/shared$': '<rootDir>/../../packages/shared/dist/index.js',
    '^@ledgera/shared/(.*)$': '<rootDir>/../../packages/shared/dist/$1',
  },

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
      },
    }],
  },

  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
  ],

  testTimeout: 30000,
};

