import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative paths so the build works on GitHub Pages from any folder.
  base: './',
  // main.ts waits for the fonts with a top-level await.
  // three.js is most of the bundle (about 150 kB gzipped), so the default
  // 500 kB warning would fire on every build.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
