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
    // Standalone public-menu build output; see vite.menu.config.ts.
    'dist-menu',
    'dist-electron',
    'node_modules',
    'reports-site/dist',
    'reports-site/node_modules',
    'scratch',
    '.zcode',
    '.eslintrc.cjs',
    // Audit artefacts: captured third-party bundles and one-off diagnostic probes saved
    // under outputs/ during live audits (e.g. the served portal/menu SPA bundles inspected
    // for leaked keys). None of it is shipped source — minified vendor code can never
    // satisfy eslint:recommended, and a probe kept for its evidence should not fail CI
    // because it stopped being used. Lint the code that ships.
    'outputs/**',
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
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    // An empty catch is how errors got silently swallowed across this project; the fixes
    // added logging, and this keeps it from creeping back.
    'no-empty': ['error', { allowEmptyCatch: false }],
  },
  overrides: [
    {
      // These provider modules intentionally co-locate their public hooks/helpers.
      // They may reload a boundary instead of preserving Fast Refresh state.
      files: ['src/context/AuthContext.tsx', 'src/context/DataContext.tsx', 'src/context/LanguageContext.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },

    {
      files: ['scripts/**/*.{mjs,cjs}', 'electron/**/*.cjs'],
      env: { browser: false, node: true, es2022: true },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
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
      // Throwaway diagnostic probes written during audits (outputs/). They are CommonJS on
      // Node, and were failing the browser profile above with `require`/`__dirname`/`Buffer`
      // reported as undefined — 40 errors that had nothing to do with shipped code.
      files: ['outputs/**/*.cjs'],
      env: { browser: false, node: true, es2022: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
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
