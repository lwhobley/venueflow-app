import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', '**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      // Measure only files exercised by tests (regression guard on tested code),
      // not the whole repo. Thresholds sit below current coverage with headroom
      // so normal fluctuation doesn't red CI; ratchet up as coverage grows.
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 78,
        lines: 75,
      },
    },
  },
});
