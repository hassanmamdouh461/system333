import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // Portal tests have an independent install/job; node:test CJS suites need Node 24.
    exclude: [...configDefaults.exclude, 'reports-site/**', '**/*.test.cjs', 'scripts/**'],
  },
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: ['**/dist/**', '**/dist-electron/**', '**/node_modules/**']
    }
  }
})
