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
  },
  // Node/edge-runtime files (Vercel middleware + Vite config) use
  // `process.env` which isn't a browser global.
  {
    files: ['middleware.js', 'vite.config.js'],
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
])
