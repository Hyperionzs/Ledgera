// ============================================================================
// Ledgera — ESLint Flat Config (v9+)
// Single config at the root, applies to all workspace packages
// ============================================================================

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,cjs}',
      'apps/backend/prisma/migrations/**',
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Shared settings for all TS files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Allow explicit any in rare cases (e.g., third-party lib wrappers)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // NestJS uses empty interfaces for dependency injection tokens
      '@typescript-eslint/no-empty-interface': 'off',

      // Allow require() in NestJS decorators and configs
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // React-specific rules (frontend only)
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Backend-specific rules
  {
    files: ['apps/backend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  eslintConfigPrettier,
);
