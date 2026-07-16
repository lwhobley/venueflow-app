import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', '**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      // Include untested source files so coverage cannot be made to look high
      // by simply omitting difficult modules from the report.
      all: true,
      include: ['packages/api/src/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.integration.spec.ts', '**/test/**', '**/*.d.ts'],
      thresholds: {
        statements: 15,
        branches: 14,
        functions: 14,
        lines: 16,
      },
    } as any,
  },
});
