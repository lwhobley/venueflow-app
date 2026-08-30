import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  // Component tests use mocks; loading `.env.local` would couple them to
  // production credentials and makes the suite unavailable in clean CI.
  envDir: false,
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
      // Raised after adding the clock and reports screen specs — the time clock
      // drives payroll and the reports screen shipped two contract bugs, and
      // neither had any coverage (measured: statements 6.07, branches 5.55,
      // functions 4.63, lines 6.53 — kept a small margin below each so the gate
      // doesn't flake on minor variance).
      thresholds: {
        statements: 5.9,
        branches: 5.4,
        functions: 4.5,
        lines: 6.3,
      },
    } as any,
  },
});
