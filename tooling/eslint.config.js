import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['.output/**', '.nitro/**', '.tanstack/**', '.agents/**', 'dist/**', 'dist-pages/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'public/sw.js', 'src/routeTree.gen.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/modules/**'], message: 'Shared code cannot import feature modules.' }] }] },
  },
)
