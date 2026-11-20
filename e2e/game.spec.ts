import { expect, type Page, test } from '@playwright/test'

// The game is driven through the page the way a player would. The ?test
// hooks are used to read state and to move the simulation on, so the tests
// do not depend on how fast the machine can draw frames. CI machines have
// no graphics card and draw very slowly.

type State = {
  mode: string
  kind: string
  phase: string
  clock: number
  place: number
  lap: number
  laps: number
  speed: number
  finished: boolean
  out: boolean
  lapTimes: number[]
  drift: number
  pursuit: { busted: number; escape: number; heat: number; outcome: string | null }
  police: number
  traffic: number
  weather: string
}
const state = (page: Page) => page.evaluate(() => (window as any).__neon.state() as State)
const forward = (page: Page, seconds: number) => page.evaluate((s) => (window as any).__neon.game.fastForward(s), seconds)
// Low graphics on CI, where every frame is drawn in software.
const open = (page: Page, query = '') => page.goto(`./?test${process.env.CI ? '&quality=low' : ''}${query}`)

// Main menu, then Quick race, pick the event, Start, and skip the fly-in.
async function quickRace(page: Page, kind = 'race') {
  await page.locator('#go-quick').click()
  await page.locator(`#kind button[data-value="${kind}"]`).click()
  await page.locator('#go-race').click()
  await expect(page.locator('#intro')).toBeVisible()
  await forward(page, 3.2)
  await expect(page.locator('#hud')).toBeVisible({ timeout: 15000 })
  expect((await state(page)).phase).toBe('racing')
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`console error: ${message.text()}`)
  })
})

// Mean brightness of the page as rendered, 0 to 255. A blank or failed
// WebGL canvas comes out near zero.
async function brightness(page: Page): Promise<number> {
  const shot = await page.screenshot({ type: 'png' })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 90
    const g = c.getContext('2d') as CanvasRenderingContext2D
    g.drawImage(img, 0, 0, 160, 90)
    const data = g.getImageData(0, 0, 160, 90).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
    return sum / (data.length / 4)
  }, shot.toString('base64'))
}

test('the title screen draws the city', async ({ page }) => {
  await open(page)
  await expect(page.locator('#menu')).toBeVisible()
  await expect(page.locator('.logo')).toContainText('Neon')
  // Machines without a graphics card take a while over the first frames
  // of the daytime valley, so keep looking for a few seconds.
  await expect.poll(() => brightness(page), { timeout: 15000, intervals: [800, 1000, 2000] }).toBeGreaterThan(8)
})

test('the car moves under the player’s control', async ({ page, isMobile }) => {
  await open(page)
  await quickRace(page)
  const throttleSeen = () => expect.poll(() => page.evaluate(() => (window as any).__neon.game.race.playerInput.throttle), { timeout: 15000 }).toBe(1)
  if (isMobile) {
    await expect(page.locator('#touch')).toBeVisible()
    const box = (await page.locator('[data-touch="gas"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await throttleSeen()
    await forward(page, 1.5)
    await page.mouse.up()
  } else {
    await page.keyboard.down('ArrowUp')
    await throttleSeen()
    await forward(page, 1.5)
    await page.keyboard.up('ArrowUp')
  }
  expect((await state(page)).speed).toBeGreaterThan(20)
  await expect.poll(async () => Number(await page.locator('#speed').textContent()), { timeout: 15000 }).toBeGreaterThan(0)
})

test('a race runs to the results table, and the replay plays it back', async ({ page }) => {
  await open(page, '&autopilot&laps=1')
  await quickRace(page)
  expect((await state(page)).traffic).toBeGreaterThan(0)
  await forward(page, 120)
  expect((await state(page)).finished).toBe(true)
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#standings tr')).toHaveCount(7)
  await expect(page.locator('#result-note')).toContainText('racing line')
  await page.locator('#watch').click()
  await expect(page.locator('#replay-ui')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__neon.game.replayTime), { timeout: 15000 }).toBeGreaterThan(0)
  await page.locator('#rp-cam').click()
  await expect(page.locator('#rp-cam')).toHaveText('Chase')
  await page.locator('#rp-exit').click()
  await expect(page.locator('#results')).toBeVisible()
  await page.locator('#to-menu').click()
  await expect(page.locator('#menu')).toBeVisible()
})

test('time trial saves a ghost of the best lap', async ({ page }) => {
  await open(page, '&autopilot&laps=2&seed=ghost-test')
  await quickRace(page, 'trial')
  await forward(page, 140)
  const s = await state(page)
  expect(s.kind).toBe('trial')
  expect(s.lapTimes).toHaveLength(2)
  const saved = await page.evaluate(() => localStorage.getItem('neon-apex/ghost/ghost-test'))
  expect(saved).not.toBeNull()
  expect(JSON.parse(saved as string).time).toBeCloseTo(Math.min(...s.lapTimes), 2)
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await page.locator('#again').click()
  await forward(page, 3.2)
  await expect(page.locator('#ghost-row')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('#ghost-time')).not.toHaveText('none yet', { timeout: 15000 })
})

test('a pursuit puts police on the road and shows the meters', async ({ page }) => {
  await open(page, '&autopilot')
  await quickRace(page, 'pursuit')
  await forward(page, 10)
  const s = await state(page)
  expect(s.police).toBeGreaterThanOrEqual(2)
  await expect(page.locator('#pursuit')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('#goal')).toContainText('patrol car')
})

test('pause stops the race and resume carries on', async ({ page, isMobile }) => {
  await open(page)
  await quickRace(page)
  if (isMobile) await page.locator('#touch-pause').click()
  else await page.keyboard.press('Escape')
  await expect(page.locator('#pause')).toBeVisible({ timeout: 15000 })
  const frozen = (await state(page)).clock
  await page.waitForTimeout(800)
  expect((await state(page)).clock).toBe(frozen)
  await page.locator('#resume').click()
  await expect(page.locator('#pause')).toBeHidden()
  await expect.poll(async () => (await state(page)).clock, { timeout: 15000 }).toBeGreaterThan(frozen)
})

test('a new random track goes into the address bar', async ({ page }) => {
  await open(page)
  await page.locator('#go-quick').click()
  await page.locator('#new-track').click()
  await expect(page.locator('#track-name')).toContainText('Track #')
  expect(new URL(page.url()).searchParams.get('seed')).toMatch(/^random-/)
  await page.locator('#tonight').click()
  await expect(page.locator('#track-name')).toHaveText("Today's track")
})

test('the career pays out, and cash buys a car in the garage', async ({ page }) => {
  await open(page, '&autopilot')
  await page.locator('#go-career').click()
  // Only the first tier is open at the start.
  await expect(page.locator('.event[data-event="first-night"]')).toBeEnabled()
  await expect(page.locator('.event[data-event="downpour"]')).toBeDisabled()
  await page.locator('.event[data-event="first-night"]').click()
  await forward(page, 3.2)
  await forward(page, 200)
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#reward')).toContainText('cash')
  const cash = await page.evaluate(() => (window as any).__neon.progress().cash)
  expect(cash).toBeGreaterThan(0)

  // Give the career enough cash for the Kite and buy it.
  await page.evaluate(() => localStorage.setItem('neon-apex/career', JSON.stringify({ cash: 7000, owned: ['vanta'], won: {} })))
  await open(page)
  await page.locator('#go-garage').click()
  await page.locator('#car-list button[data-car="volt"]').click()
  await expect(page.locator('#car-action')).toBeDisabled()
  await page.locator('#car-list button[data-car="kite"]').click()
  await expect(page.locator('#car-action')).toHaveText('Buy for 6,000')
  await page.locator('#car-action').click()
  await expect(page.locator('#car-action')).toHaveText('Driving this one')
  await expect(page.locator('#garage-cash')).toHaveText('1,000')
})

test('a phone held upright is asked to turn sideways, and the race waits', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones only')
  await open(page)
  await expect(page.locator('#rotate')).toBeHidden()
  await quickRace(page)
  const size = page.viewportSize() as { width: number; height: number }
  await page.setViewportSize({ width: size.height, height: size.width })
  await expect(page.locator('#rotate')).toBeVisible()
  await expect(page.locator('#rotate')).toContainText('Turn your phone sideways')
  await expect(page.locator('#pause')).toBeVisible()
  expect((await state(page)).mode).toBe('paused')
  await page.setViewportSize(size)
  await expect(page.locator('#rotate')).toBeHidden()
})
