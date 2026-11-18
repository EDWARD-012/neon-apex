import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative paths so the build works on GitHub Pages from any folder.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
