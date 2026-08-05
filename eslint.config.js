//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
  {
    // The reui Event Calendar is a copy-and-own third-party component.
    // Its import style and type assertions don't match our stricter config,
    // and the source should not be edited beyond import-path fixes.
    files: ['src/components/reui/**'],
    rules: {
      'import/consistent-type-specifier-style': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/method-signature-style': 'off',
      '@typescript-eslint/naming-convention': 'off',
    },
  },
]
