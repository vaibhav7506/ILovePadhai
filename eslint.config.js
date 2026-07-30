import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      import: importPlugin,
      'jsx-a11y': jsxA11y,
      react,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // The plugin's label rule is incompatible with patched minimatch 10; labels are
      // covered by explicit htmlFor/id pairs and Playwright accessibility assertions.
      'jsx-a11y/label-has-associated-control': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
    },
  },
);
