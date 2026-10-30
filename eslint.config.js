// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The baseline is the non-type-checked preset, and the three type-aware rules
 * that are actually worth the cost are enabled individually.
 *
 * The full recommendedTypeChecked preset was tried and rejected: require-await
 * flags every Fastify route handler, which is async by convention rather than
 * because it awaits, and the no-unsafe-* family flags every JSON.parse of a
 * response body in the tests. Both would have to be switched off anyway, and a
 * linter that is mostly suppressions stops being read.
 */
export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'drizzle/', 'fixtures/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Not projectService: that resolves the nearest tsconfig.json, whose
        // include is ["src"] because it drives the build. tests/ is outside it,
        // so every test file failed to parse. tsconfig.typecheck.json already
        // spans src and tests, which is exactly the surface to lint.
        project: ['./tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves identifiers already, and the base rule knows
      // nothing about Node globals or type-only imports.
      'no-undef': 'off',

      // A missing await in a route handler swallows the error and returns a
      // 200. This is the rule that pays for type-aware linting on its own.
      '@typescript-eslint/no-floating-promises': 'error',

      // An async callback passed where a synchronous one is expected: the
      // rejection goes nowhere. Relevant for every Fastify hook.
      '@typescript-eslint/no-misused-promises': 'error',

      // Awaiting a non-promise is usually a forgotten call or a bad import.
      '@typescript-eslint/await-thenable': 'error',

      // Everything user-facing goes through the Fastify logger, which redacts
      // secrets and scrubs query strings. console bypasses all of that, so a
      // deliberate use needs an inline disable saying why.
      'no-console': 'error',

      // An unused parameter is usually a signature that drifted. A leading
      // underscore marks one that is ignored on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // This config file is plain JS with no tsconfig to resolve against.
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
