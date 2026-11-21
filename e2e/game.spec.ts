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
// Low graphics on CI, where every frame is drawn in software. Chromium on
// CI also skips the 3D drawing unless the test looks at the picture: its
// software WebGL can take minutes over a first frame. The frame loop, the
// HUD and the menus still run. WebKit and the phone draw every test there,
// so drawing errors still fail a test.
const open = (page: Page, query = '', draw = false) => {
  const skip = Boolean(process.env.CI) && !draw && test.info().project.name === 'chromium'
  return page.goto(`./?test${process.env.CI ? '&quality=low' : ''}${skip ? '&nodraw' : ''}${query}`)
}

// Main menu, then Quick race, pick the event, Start, and skip the fly-in.
async function quickRace(page: Page, kind = 'race', police = true) {
  await page.locator('#go-quick').click()
  await page.locator(`#kind button[data-value="${kind}"]`).click()
  if (!police) await page.locator('#police button[data-value="off"]').click()
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
  // A software renderer compiles every shader of the daytime valley before
  // the first frame shows: 36 programs, about 11 s on a fast Mac. On a
  // shared CI runner with another test beside it, that has taken from 51 s
  // to over 90 s.
  test.setTimeout(210_000)
  await open(page, '', true)
  await expect(page.locator('#menu')).toBeVisible()
  await expect(page.locator('.logo')).toContainText('Skidline')
  await expect.poll(() => brightness(page), { timeout: 160_000, intervals: [800, 1000, 2000, 4000] }).toBeGreaterThan(8)
})

test('the car moves under the player’s control', async ({ page, isMobile }) => {
  await open(page)
  await quickRace(page)
  const throttleSeen = () => expect.poll(() => page.evaluate(() => (window as any).__neon.game.race.playerInput.throttle), { timeout: 15000 }).toBeGreaterThan(0.9)
  if (isMobile) {
    await expect(page.locator('#touch')).toBeVisible()
    // Near the top of the gas pedal is full throttle.
    const box = (await page.locator('[data-pedal="gas"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.08)
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
  // Police off, so a patrol car cannot end the race early.
  await quickRace(page, 'race', false)
  expect((await state(page)).traffic).toBeGreaterThan(0)
  expect((await state(page)).police).toBe(0)
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
  // The two racer tools, ready to use.
  await expect(page.locator('#tools-hud .tool')).toHaveCount(2)
})

test('playing the cop: the player drives a police car and busts the racers', async ({ page }) => {
  await open(page)
  await quickRace(page, 'cop')
  await forward(page, 5)
  await expect(page.locator('#goal')).toContainText('Busted 0 of 4', { timeout: 15000 })
  await expect(page.locator('#tools-hud .tool')).toHaveCount(2)
  // A racer with its damage bar full is busted, and the count goes up.
  await page.evaluate(() => ((window as any).__neon.game.race.racers[0].car.damage = 1))
  await forward(page, 0.2)
  await expect(page.locator('#goal')).toContainText('Busted 1 of 4', { timeout: 15000 })
})

test('a patrol car waits by the road in a race and chases a car that flies past', async ({ page }) => {
  await open(page)
  await page.locator('#go-career').click()
  await expect(page.locator('.event[data-event="first-night"] .kind')).toContainText('police')
  await expect(page.locator('.event[data-event="wet-paint"] .kind')).not.toContainText('police')
  await page.locator('#career .back').click()
  await quickRace(page)
  const cops = () => page.evaluate(() => {
    const race = (window as any).__neon.game.race
    return { police: race.police.length, parked: race.parked.size, chasing: race.chasing }
  })
  expect(await cops()).toEqual({ police: 1, parked: 1, chasing: false })
  // Put the car 40 m short of the patrol car at 144 km/h and let it roll.
  await page.evaluate(() => {
    const race = (window as any).__neon.game.race
    const t = race.track
    const j = (race.police[0].hint - 20 + t.n) % t.n
    Object.assign(race.player.car, { x: t.x[j], z: t.z[j], heading: Math.atan2(t.tx[j], t.tz[j]), vx: t.tx[j] * 40, vz: t.tz[j] * 40, yawRate: 0, hint: j })
  })
  await forward(page, 1.5)
  expect(await cops()).toMatchObject({ parked: 0, chasing: true })
  await expect(page.locator('#pursuit')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('#goal')).toContainText('Police on you')
})

test('the race HUD shows the standings with gaps, the time, the map and the speed', async ({ page }) => {
  await open(page)
  await quickRace(page, 'race', false)
  await forward(page, 4)
  await expect(page.locator('#board li')).toHaveCount(5, { timeout: 15000 })
  await expect(page.locator('#board li.you')).toContainText('You')
  await expect(page.locator('#board .gap').first()).toHaveText(/^[+-]?\d+\.\d$/)
  await expect(page.locator('#race-time')).toHaveText(/^0:0\d\.\d\d$/)
  await expect(page.locator('#minimap')).toBeVisible()
  await expect(page.locator('#speed')).toBeVisible()
})

test('the driving aids in Settings are kept and used in the race', async ({ page }) => {
  await open(page)
  await page.locator('#go-settings').click()
  await page.locator('#brake-assist button[data-value="on"]').click()
  await page.locator('#stability button[data-value="off"]').click()
  await open(page)
  await page.locator('#go-settings').click()
  await expect(page.locator('#brake-assist button.on')).toHaveAttribute('data-value', 'on')
  await expect(page.locator('#stability button.on')).toHaveAttribute('data-value', 'off')
  await page.locator('#settings-screen .back').click()
  await quickRace(page, 'race', false)
  await forward(page, 1)
  // The player's input is set by the frame loop, not by fast-forwarding,
  // and on CI's software GL the first frame can take a while to draw.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const race = (window as any).__neon.game.race
          return { brake: race.brakeHelp, raw: race.playerInput.raw, drift: race.playerInput.assist }
        }),
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toEqual({ brake: true, raw: true, drift: true })
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
  // This week's track has its own seed, and today's challenge is shown.
  await page.locator('#weekly').click()
  await expect(page.locator('#track-name')).toHaveText("This week's track")
  expect(new URL(page.url()).searchParams.get('seed')).toMatch(/^week-\d{4}-W\d{2}$/)
  await expect(page.locator('#challenge-note')).toContainText("Today's challenge")
})

test('saves carried over from the old address are kept, and the link is tidied', async ({ page }) => {
  // The old address hands its saves over in the link (see the script at the
  // top of index.html). The new one keeps them when it has none of its own.
  const career = JSON.stringify({ cash: 4321, owned: ['vanta', 'kite'], won: {} })
  const carry = encodeURIComponent(JSON.stringify({ 'neon-apex/career': career, 'other/key': 'ignored' }))
  await open(page, `#carry=${carry}`)
  await expect.poll(() => page.evaluate(() => (window as any).__neon?.progress().cash), { timeout: 60_000 }).toBe(4321)
  expect(await page.evaluate(() => location.hash)).toBe('')
  expect(await page.evaluate(() => localStorage.getItem('other/key'))).toBeNull()
  // A second carry does not overwrite saves the new address already has.
  const newer = encodeURIComponent(JSON.stringify({ 'neon-apex/career': JSON.stringify({ cash: 5, owned: ['vanta'], won: {} }) }))
  await open(page, `#carry=${newer}`)
  await expect.poll(() => page.evaluate(() => (window as any).__neon?.progress().cash), { timeout: 60_000 }).toBe(4321)
})

test('the career pays coins, which buy a car and its upgrades in the garage', async ({ page }) => {
  await open(page, '&autopilot')
  await page.locator('#go-career').click()
  // Only the first tier is open at the start.
  await expect(page.locator('.event[data-event="first-night"]')).toBeEnabled()
  await expect(page.locator('.event[data-event="downpour"]')).toBeDisabled()
  await page.locator('.event[data-event="first-night"]').click()
  await forward(page, 3.2)
  await forward(page, 200)
  await expect(page.locator('#results')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#reward')).toContainText('coins')
  const cash = await page.evaluate(() => (window as any).__neon.progress().cash)
  expect(cash).toBeGreaterThan(0)

  // Give the career enough coins for the Kite and buy it.
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

  // Then the first engine stage, which is 15% of the car's price.
  await page.locator('#garage-tab button[data-value="upgrades"]').click()
  await expect(page.locator('#parts .part')).toHaveCount(8)
  // The Kite is class C stock; the first engine stage takes it to 247 km/h
  // and class B.
  await expect(page.locator('#car-speed')).toHaveText(/^Class C \d+ \(B \d+ with stage 1\), top speed 238 km\/h, 247 km\/h with stage 1$/)
  await expect(page.locator('#car-action')).toHaveText('Fit stage 1 for 900')
  await page.locator('#car-action').click()
  await expect(page.locator('#garage-cash')).toHaveText('100')
  await expect(page.locator('#parts .part[data-part="engine"] .pips i.on')).toHaveCount(1)
  await expect(page.locator('#car-action')).toHaveText('Stage 2 needs 1,800 coins')
  await expect(page.locator('#car-action')).toBeDisabled()
  // The Looks tab: four finishes and seven underglow choices, the free
  // ones already usable.
  await page.locator('#garage-tab button[data-value="looks"]').click()
  await expect(page.locator('#looks button')).toHaveCount(11)
  await expect(page.locator('#looks button[data-look="gloss"]')).toHaveClass(/on/)
  // The next race is driven with the upgraded engine.
  const top = await page.evaluate(() => {
    const neon = (window as any).__neon
    neon.start('race')
    return neon.game.race.player.car.spec.topSpeed as number
  })
  expect(top).toBeCloseTo(66 * 1.04, 5)
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

test('on a phone the wheel steers, the brake pedal brakes, and pause has look back and reset', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones only')
  await open(page)
  await quickRace(page)
  const input = (name: string) => page.evaluate((n) => (window as any).__neon.game.input[n], name)
  const wheel = (await page.locator('#touch-wheel').boundingBox())!
  await page.mouse.move(wheel.x + wheel.width * 0.5, wheel.y + wheel.height * 0.6)
  await page.mouse.down()
  await page.mouse.move(wheel.x + wheel.width * 0.95, wheel.y + wheel.height * 0.6, { steps: 6 })
  await expect.poll(() => input('analogSteer')).toBeGreaterThan(0.5)
  await page.mouse.up()
  await expect.poll(() => input('analogSteer')).toBe(null)
  const brake = (await page.locator('[data-pedal="brake"]').boundingBox())!
  await page.mouse.move(brake.x + brake.width / 2, brake.y + brake.height / 2)
  await page.mouse.down()
  await expect.poll(() => input('analogBrake')).toBeGreaterThan(0.3)
  await page.mouse.up()
  await page.locator('#touch-pause').click()
  await expect(page.locator('#pause-look')).toBeVisible()
  await page.locator('#pause-reset').click()
  await expect(page.locator('#pause')).toBeHidden()
})

test('on a phone the camera button changes the view', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones only')
  await open(page)
  await quickRace(page)
  const camera = () => page.evaluate(() => (window as any).__neon.game.camMode as string)
  expect(await camera()).toBe('chase')
  await page.locator('#touch-camera').tap()
  await expect.poll(camera).toBe('far')
  await page.locator('#touch-camera').tap()
  await expect.poll(camera).toBe('cockpit')
  // In the cockpit the dash shows the speed, so the speedo panel and the
  // pedal bars go.
  await expect(page.locator('#pedals')).toBeHidden()
  await expect(page.locator('#hud')).toHaveClass(/cockpit-view/)
  await expect(page.locator('#hud .gauge')).toBeHidden()
  await page.locator('#touch-camera').tap()
  await expect(page.locator('#hud')).not.toHaveClass(/cockpit-view/)
})
