import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['src/**/*.rules.test.ts'], testTimeout: 20000, server: { deps: { inline: [/firebase/, /@firebase/] } } },
})
