// Takes the screenshots and GIF frames the README uses by playing the built
// game in a headless browser. Run with: npm run shots
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { preview } from 'vite'

const OUT = 'docs'
const FRAMES = 'node_modules/.cache/shots'
const SEED = 'readme'

const server = await preview({ preview: { port: 4176, strictPort: true } })
const base = 'http://localhost:4176/'
// On a Mac, Chrome's GPU path keeps the GIF capture at full frame rate.
const browser = await chromium.launch({
  channel: process.env.E2E_CHROME_CHANNEL,
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [],
})

const neon = (page: Page, code: string) => page.evaluate(code)

async function open(page: Page, query: string) {
  await page.goto(`${base}?test&seed=${SEED}${query}`)
  await page.waitForFunction(() => (window as unknown as { __neon?: unknown }).__neon)
  await page.waitForTimeout(800)
}

mkdirSync(OUT, { recursive: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

// Title screen.
await open(page, '')
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/title.jpg`, quality: 85 })
// The same screen at the size link previews use.
await page.setViewportSize({ width: 1200, height: 630 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'public/og.jpg', quality: 85 })
await page.setViewportSize({ width: 1280, height: 720 })

// Nitro and a drift, driven with the keyboard.
await open(page, '')
await page.locator('#go-race').click()
await page.waitForTimeout(3300)
await page.keyboard.down('ArrowUp')
await page.waitForTimeout(3200)
await page.keyboard.down('ShiftLeft')
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/nitro.jpg`, quality: 85 })
await page.keyboard.up('ShiftLeft')
await page.keyboard.down('ArrowRight')
await page.keyboard.down('Space')
// Wait until the car really is sliding, so the picture shows a drift.
await page.waitForFunction(() => (window as any).__neon.game.race.player.car.slip > 0.35, null, { timeout: 3000, polling: 16 })
await page.keyboard.up('Space')
await page.waitForTimeout(150)
await page.screenshot({ path: `${OUT}/drift.jpg`, quality: 85 })
await page.keyboard.up('ArrowRight')
await page.keyboard.up('ArrowUp')

// Results after a one-lap race, the player driven by the AI.
await open(page, '&autopilot&laps=1')
await page.locator('#go-race').click()
await neon(page, 'window.__neon.game.fastForward(120)')
await page.locator('#results').waitFor({ state: 'visible', timeout: 10000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/results.jpg`, quality: 85 })

// GIF frames: the start of a race in real time, the player on autopilot.
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })
const film = await browser.newPage({ viewport: { width: 960, height: 540 } })
await open(film, '&autopilot')
await film.locator('#go-race').click()
await film.waitForTimeout(2600)
const frames: { file: string; at: number }[] = []
const started = Date.now()
while (Date.now() - started < 7500) {
  const file = `frame-${String(frames.length).padStart(3, '0')}.jpg`
  const at = Date.now() - started
  writeFileSync(`${FRAMES}/${file}`, await film.screenshot({ type: 'jpeg', quality: 90 }))
  frames.push({ file, at })
}
writeFileSync(`${FRAMES}/frames.json`, JSON.stringify({ frames, end: Date.now() - started }))
console.log(`${frames.length} frames`)

await browser.close()
server.httpServer.close()
