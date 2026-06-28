import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  css: {
    postcss: {},
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@types': path.resolve(__dirname, '../types'),
    },
  },
})
