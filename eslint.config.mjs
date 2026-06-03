import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Disallow `any` — the primary issue this config addresses.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow `_` prefixed unused vars (common in callbacks).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Prefer const assertions over type assertions where possible.
      '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'as' }],
      // Require explicit return types on exported functions.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Disallow non-null assertions (prefer explicit null checks).
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // No console.log in production code.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
    ignores: [
      'node_modules/**',
      'convex/_generated/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
    ],
  },
);
