// Takes the screenshots and the GIF frames the README uses by playing the
// built game in a headless browser. Run with: npm run shots
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { preview } from 'vite'

const OUT = 'docs'
const FRAMES = 'node_modules/.cache/shots'

const server = await preview({ preview: { port: 4176, strictPort: true } })
const base = 'http://localhost:4176/'
// On a Mac, Chrome's GPU path keeps the GIF capture at full frame rate.
const browser = await chromium.launch({
  channel: process.env.E2E_CHROME_CHANNEL,
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [],
})

const run = (page: Page, code: string) => page.evaluate(code)

async function open(page: Page, query: string) {
  await page.goto(`${base}?test${query}`)
  await page.waitForFunction(() => (window as unknown as { __neon?: unknown }).__neon)
  await page.waitForTimeout(1000)
}

// Jumps every one-off animation to its end so a still shows a settled page.
const settle = (page: Page) =>
  page.evaluate(() => {
    for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish()
  })

mkdirSync(OUT, { recursive: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const shot = async (name: string) => {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.jpg`, quality: 85 })
}

// Title screen, and the same at link-preview size.
await open(page, '&seed=readme&weather=day')
await page.waitForTimeout(2500)
await shot('title')
await page.setViewportSize({ width: 1200, height: 630 })
await page.waitForTimeout(600)
await page.screenshot({ path: 'public/og.jpg', quality: 85 })
await page.setViewportSize({ width: 1280, height: 720 })

// Career and garage.
await page.click('#go-career')
await page.waitForTimeout(500)
await shot('career')
await page.click('#career .back')
await page.click('#go-garage')
await page.click('#car-list button[data-car="brute"]')
await page.waitForTimeout(1500)
await shot('garage')
await page.click('#garage .back')

// Rain: nitro on a wet road, driven with the keyboard.
await open(page, '&seed=readme&weather=rain')
await run(page, `window.__neon.begin(window.__neon.quickSpec('race'))`)
await run(page, 'window.__neon.game.fastForward(3.2)')
await page.keyboard.down('ArrowUp')
await page.waitForTimeout(3500)
await page.keyboard.down('ShiftLeft')
await page.waitForTimeout(900)
await shot('nitro')
await page.keyboard.up('ShiftLeft')
// A drift: hold the handbrake until the car is really sliding.
await page.keyboard.down('ArrowRight')
await page.keyboard.down('Space')
await page.waitForFunction(() => (window as any).__neon.game.race.player.car.slip > 0.35, null, { timeout: 4000, polling: 16 })
await page.keyboard.up('Space')
await page.waitForTimeout(150)
await shot('drift')
await page.keyboard.up('ArrowRight')
await page.keyboard.up('ArrowUp')

// The cockpit camera on the mountain road, driven with the keyboard so the
// needles are up.
await open(page, '&seed=readme&weather=day')
await run(page, `window.__neon.begin(window.__neon.quickSpec('race'))`)
await run(page, 'window.__neon.game.fastForward(3.2)')
await run(page, `window.__neon.game.camMode = 'cockpit'`)
await page.keyboard.down('ArrowUp')
await page.waitForTimeout(3500)
await shot('cockpit')
await run(page, `window.__neon.game.camMode = 'chase'`)
await page.waitForTimeout(1500)
await shot('day')
await page.keyboard.up('ArrowUp')
// Damage: hits on the front left and the rear right, recorded the same way
// a barrier or another car records them, then a close-up with time stopped.
await run(
  page,
  `const car = window.__neon.game.race.player.car
  for (const [x, z, s] of [[0.6, 2.2, 14], [0.95, 1.2, 12], [0.95, 0.2, 9], [-0.7, -2.2, 13], [-0.95, -1.4, 10]]) car.hits.push(x, 0.55, z, s)
  car.damage = 0.45`,
)
await page.waitForTimeout(300)
await run(
  page,
  `const g = window.__neon.game
  g.timeScale = 0
  g.cameraOverride = (cam) => {
    const c = g.race.player.car
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
    cam.position.set(c.x + fx * 4.2 + fz * 3.2, 1.25, c.z + fz * 4.2 - fx * 3.2)
    cam.lookAt(c.x, 0.6, c.z)
    cam.fov = 42
    cam.updateProjectionMatrix()
  }`,
)
await page.waitForTimeout(600)
await shot('damage')

// The fly-in before a race, part of the way through.
await open(page, '&seed=readme&weather=dusk')
await run(page, `window.__neon.begin(window.__neon.quickSpec('race'))`)
await page.waitForTimeout(3000)
await shot('intro')

// A pursuit at dusk, from behind the nearest patrol car.
await open(page, '&seed=readme&weather=dusk&autopilot')
await run(page, `window.__neon.begin({ ...window.__neon.quickSpec('pursuit'), police: 3 })`)
await run(page, 'window.__neon.game.fastForward(14)')
await run(
  page,
  `window.__neon.game.cameraOverride = (cam) => {
    const g = window.__neon.game
    const p = g.race.player.car
    let cop = g.race.police[0]
    for (const c of g.race.police) if (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(cop.x - p.x, cop.z - p.z)) cop = c
    const fx = Math.sin(cop.heading), fz = Math.cos(cop.heading)
    cam.position.set(cop.x - fx * 7 + fz * 1.5, 2.4, cop.z - fz * 7 - fx * 1.5)
    cam.lookAt((cop.x + p.x) / 2, 1, (cop.z + p.z) / 2)
    cam.fov = 55
    cam.updateProjectionMatrix()
  }`,
)
await page.waitForTimeout(800)
await shot('pursuit')

// Results after a one-lap race, then the replay from the TV cameras.
await open(page, '&seed=readme&weather=clear&autopilot&laps=1')
await run(page, `window.__neon.begin(window.__neon.quickSpec('race'))`)
await run(page, 'window.__neon.game.fastForward(120)')
await page.locator('#results').waitFor({ state: 'visible', timeout: 15000 })
await page.waitForTimeout(800)
await shot('results')
await page.click('#watch')
await run(page, 'window.__neon.game.replayTime = 14')
await page.waitForTimeout(1200)
await shot('replay')

// GIF frames: the start of a race in the rain, in real time.
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })
const film = await browser.newPage({ viewport: { width: 960, height: 540 } })
await open(film, '&seed=readme&weather=rain&autopilot')
await run(film, `window.__neon.begin(window.__neon.quickSpec('race'))`)
await run(film, 'window.__neon.game.skipIntro()')
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
