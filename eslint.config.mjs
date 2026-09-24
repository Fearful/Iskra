import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'warn',
        },
    },
    {
        // Tests reach into internals on purpose (`(pm as any).processes`) and
        // may print; there these rules only add noise over real findings.
        files: ['**/test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
        },
    },
    {
        // Programs whose output is the console: the templates are example apps
        // and db-kit's cli.ts is the `iskra-db` command.
        files: ['templates/**/*.ts', 'packages/db-kit/src/cli.ts'],
        rules: {
            'no-console': 'off',
        },
    },
    {
        ignores: ['node_modules/', 'dist/', '**/*.js', '**/*.mjs'],
    },
);
