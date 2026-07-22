// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'docs/**',
      'eslint.config.mjs',
      'jest.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier, // prettier bilan to'qnashadigan format qoidalarini o'chiradi
  {
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Loyihaga moslashtirilgan (juda qattiq emas — ishga to'sqinlik qilmasin)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
