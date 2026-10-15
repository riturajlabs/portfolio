import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.vercel']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Context objects are private by convention, so the only shared exports in
    // these files are the `useX` hooks; Fast Refresh gets confused by them.
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, allowExportNames: ['useAuth', 'useToast'] },
      ],
    },
  },
  // Vitest test files run under node + jsdom, so the vitest globals
  // (`describe`, `it`, `expect`, `vi`, ...) are defined there, not on
  // `window`. The setup file imports jest-dom matchers.
  {
    files: ['src/**/*.{test,spec}.{js,jsx}', 'vitest.setup.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  // Node/edge-runtime files (Vercel middleware + Vite config) use
  // `process.env` which isn't a browser global.
  {
    files: ['middleware.js', 'vite.config.js', 'src/lib/content.js', 'playwright.config.js'],
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },
  // Build-time prerender scripts run in Node and deliberately re-export
  // non-component helpers for the generator, so the Fast Refresh
  // "only export components" rule has nothing to say about them.
  {
    files: ['scripts/**/*.js', 'scripts/**/*.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // The icon registry (ADR-008) exports the `react-icons` map and the
  // `resolveIcon`/`UnknownIcon` helpers the public components and the
  // admin share; it is not a components file, so Fast Refresh never
  // applies to it.
  {
    files: ['src/components/icons.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
