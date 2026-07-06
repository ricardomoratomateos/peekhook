import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.js'],
    testTimeout: 20_000,
    pool: 'forks',
  },
})
