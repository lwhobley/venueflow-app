import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The React Native package ships Flow syntax that Vite does not transform
    // in Node. The web implementation exposes the same component contract for
    // deterministic component tests.
    alias: { 'react-native': 'react-native-web' },
  },
  test: {
    include: ['tests/ui/**/*.spec.tsx', 'components/**/*.spec.tsx'],
    exclude: [...configDefaults.exclude, '.claude/**'],
    setupFiles: ['tests/ui/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: true,
      include: ['app/**/*.tsx', 'components/**/*.tsx'],
      exclude: ['**/*.spec.tsx'],
      // This ratchet covers every app and component file instead of hiding
      // untested screens. It starts at the measured repository-wide baseline;
      // new tests should raise it without narrowing the include set.
      // Raised after adding the host-error-boundary regression spec (measured:
      // statements 3.88, branches 2.77, functions 3.11, lines 4.18 — kept a
      // small margin below each so the gate doesn't flake on minor variance).
      thresholds: {
        statements: 3.8,
        branches: 2.7,
        functions: 3.0,
        lines: 4.1,
      },
    } as any,
  },
});
