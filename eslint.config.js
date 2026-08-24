import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The repo is a browser↔service integration layer (kepler.gl glue,
      // command args) that uses `any` at the adapter seams. Enabling this rule
      // would gate every existing file on ~110 mechanical edits; revisit once
      // the adapter layer is tightened.
      '@typescript-eslint/no-explicit-any': 'off',
      // `_`-prefixed names are the intentional "ignore me" convention
      // (callback contexts, reserved slots).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none'}
      ]
    }
  }
);
