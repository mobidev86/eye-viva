/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackStart(), react()],
  test: { include: ['src/**/*.test.ts'], exclude: ['src/**/*.rules.test.ts', 'node_modules/**'] },
})
