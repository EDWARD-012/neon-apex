import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { buildUpdatesPage } from './scripts/changelog'

// updates.html is built from changes/<day>/<HHMM>-<slug>.html, one file per
// update, so pull requests that each add an update never collide on it.
function updatesPage(): Plugin {
  const page = () => buildUpdatesPage('scripts/updates.template.html', 'changes')
  return {
    name: 'updates-page',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/updates.html') return next()
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(page())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'updates.html', source: page() })
    },
  }
}

// The portal build (see src/portal.ts) leaves out the trailer, which only
// the website plays and which is most of the download.
function portalBuild(): Plugin {
  let trailer = ''
  return {
    name: 'portal-build',
    apply: 'build',
    configResolved(config) {
      if (config.mode === 'portal') trailer = resolve(config.root, config.build.outDir, 'trailer.webm')
    },
    closeBundle() {
      if (trailer) rmSync(trailer, { force: true })
    },
  }
}

export default defineConfig({
  // Relative paths so the build works on GitHub Pages from any folder.
  base: './',
  plugins: [updatesPage(), portalBuild()],
  // main.ts waits for the fonts with a top-level await.
  // three.js is most of the bundle (about 150 kB gzipped), so the default
  // 500 kB warning would fire on every build.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
