import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'apps/api/src/generated/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    // Type-aware rules need a TS program; .vue and plain JS files are linted without one.
    files: ['**/*.vue', '**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/web/src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**', 'apps/api/**', '*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      // Optional props typed with TypeScript already default to undefined (and the types make
      // callers handle it); requiring explicit `undefined` defaults adds noise only.
      'vue/require-default-prop': 'off',
      'no-console': 'error',
    },
  },
  {
    // Cypress: chai's property assertions (`.to.be.ok`) read as bare expressions, and command
    // chains are thenables but not promises, so these two type-aware rules don't apply.
    files: ['apps/web/cypress/**/*.ts', 'apps/web/cypress.config.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
