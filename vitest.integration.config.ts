import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.spec.ts'],
    exclude: [...configDefaults.exclude, '.claude/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
