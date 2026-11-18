import { expect, type Page, test } from '@playwright/test'

// The game is driven through the page the way a player would. The ?test
// hooks are used to read state and to move the simulation on, so the tests
// do not depend on how fast the machine can draw frames. CI machines have
// no graphics card and draw very slowly.

type State = { mode: string; kind: string; phase: string; clock: number; place: number; lap: number; laps: number; speed: number; finished: boolean; lapTimes: number[] }
const state = (page: Page) => page.evaluate(() => (window as any).__neon.state() as State)
const forward = (page: Page, seconds: number) => page.evaluate((s) => (window as any).__neon.game.fastForward(s), seconds)
// Low graphics on CI, where every frame is drawn in software.
const open = (page: Page, query = '') => page.goto(`./?test${process.env.CI ? '&quality=low' : ''}${query}`)

async function startRace(page: Page, button = '#go-race') {
  await page.locator(button).click()
  await expect(page.locator('#hud')).toBeVisible()
  await forward(page, 3.2)
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
  await page.waitForTimeout(800)
  expect(await brightness(page)).toBeGreaterThan(8)
})

test('the car moves under the player’s control', async ({ page, isMobile }) => {
  await open(page)
  await startRace(page)
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

test('a race runs to the results table', async ({ page }) => {
  await open(page, '&autopilot&laps=1')
  await startRace(page)
  await forward(page, 120)
  expect((await state(page)).finished).toBe(true)
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#standings tr')).toHaveCount(7)
  await expect(page.locator('#result-note')).toContainText('racing line')
  await page.locator('#to-menu').click()
  await expect(page.locator('#menu')).toBeVisible()
})

test('time trial saves a ghost of the best lap', async ({ page }) => {
  await open(page, '&autopilot&laps=2&seed=ghost-test')
  await startRace(page, '#go-trial')
  await forward(page, 140)
  const s = await state(page)
  expect(s.kind).toBe('trial')
  expect(s.lapTimes).toHaveLength(2)
  const saved = await page.evaluate(() => localStorage.getItem('neon-apex/ghost/ghost-test'))
  expect(saved).not.toBeNull()
  expect(JSON.parse(saved as string).time).toBeCloseTo(Math.min(...s.lapTimes), 2)
  // Racing the same track again shows the ghost's time in the HUD.
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await page.locator('#again').click()
  await expect(page.locator('#ghost-row')).toBeVisible()
  await expect(page.locator('#ghost-time')).not.toHaveText('none yet', { timeout: 15000 })
})

test('pause stops the race and resume carries on', async ({ page, isMobile }) => {
  await open(page)
  await startRace(page)
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
  await page.locator('#new-track').click()
  await expect(page.locator('#track-name')).toContainText('Track #')
  expect(new URL(page.url()).searchParams.get('seed')).toMatch(/^random-/)
  await page.locator('#tonight').click()
  await expect(page.locator('#track-name')).toHaveText("Tonight's track")
})
