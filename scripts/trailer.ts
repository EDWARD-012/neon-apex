// Records public/trailer.webm: about 36 seconds of the game, shot by a
// script inside the page. The game's own canvas is copied onto a second
// canvas every frame with the title cards drawn on top, and that canvas is
// recorded with the browser's MediaRecorder. Run with: npm run trailer
//
// It needs a GPU to run at full frame rate. On a Mac, Chrome is started with
// its Metal backend for that.
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4177, strictPort: true } })
const browser = await chromium.launch({
  channel: process.env.E2E_CHROME_CHANNEL,
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:4177/?test&autopilot&seed=trailer-day&weather=day')
await page.waitForFunction(() => (window as unknown as { __neon?: unknown }).__neon)
await page.waitForTimeout(1500)
// Hide every menu and HUD element: the trailer is the 3D view plus cards.
await page.addStyleTag({ content: 'body > *:not(#view) { display: none !important; }' })

// The shot list runs inside the page; see scripts/trailer-director.js.
const director = readFileSync(new URL('./trailer-director.js', import.meta.url), 'utf8').replace(/^\/\/.*\n/gm, '')
const video: string = await page.evaluate(`(${director})()`)

writeFileSync('public/trailer.webm', Buffer.from(video, 'base64'))
console.log(`public/trailer.webm: ${Math.round(Buffer.from(video, 'base64').length / 1024)} KB`)
await browser.close()
server.httpServer.close()
