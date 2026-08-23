import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The React Native package ships Flow syntax that Vite does not transform
    // in Node. The web implementation exposes the same component contract for
    // deterministic component tests.
    alias: { 'react-native': 'react-native-web' },
  },
  test: {
    include: ['app/**/*.spec.tsx', 'components/**/*.spec.tsx'],
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: true,
      include: ['app/**/*.tsx', 'components/**/*.tsx'],
      exclude: ['**/*.spec.tsx'],
      // This ratchet covers every app and component file instead of hiding
      // untested screens. It starts at the measured repository-wide baseline;
      // new tests should raise it without narrowing the include set.
      thresholds: {
        statements: 1.85,
        branches: 1.3,
        functions: 1.65,
        lines: 2,
      },
    } as any,
  },
});
