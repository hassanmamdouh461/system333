module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'dist-electron',
    'node_modules',
    'reports-site/dist',
    'reports-site/node_modules',
    '.eslintrc.cjs',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // The codebase predates this config and uses `any` at the IPC and D1 boundaries.
    // Warn rather than error so lint stays runnable while those are typed incrementally.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // An empty catch is how errors got silently swallowed across this project; the fixes
    // added logging, and this keeps it from creeping back.
    'no-empty': ['error', { allowEmptyCatch: false }],
  },
  overrides: [
    {
      // Cloudflare Workers: worker globals, ES modules, no React. These were excluded from
      // linting entirely, which meant the code guarding two internet-facing databases was
      // the only code nobody checked.
      files: ['cloudflare/**/*.js'],
      env: { browser: false, es2022: true, worker: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
      },
    },
    {
      // Electron main process: CommonJS on Node, no browser globals.
      files: ['electron/**/*.cjs'],
      env: { browser: false, node: true, es2022: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
      rules: {
        // CommonJS is the module format here: the Electron main process loads .cjs, and
        // better-sqlite3 is a native module that cannot be imported as ESM.
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // Build and tooling configs run on Node.
      files: ['*.config.js', '*.config.ts'],
      env: { node: true },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { node: true },
      rules: {
        // Tests assert on shapes that come back untyped from a fake binding.
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
