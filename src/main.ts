import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700-italic.css'
import '@fontsource/chakra-petch/600-italic.css'
import '@fontsource/chakra-petch/500-italic.css'
import './styles.css'
import { report, startClock } from './analytics'
import { PORTAL } from './portal'
import { carAssetsPending, loadCarAssets } from './render/carAssets'
import { fetchBytes, onLoadProgress, report as loadReport, setStep } from './loader'
import { AccountError, type Account, chooseLogin, cloudEnabled, currentAccount, googleButton, signIn, signInWithGoogle, signOut, uploadProgress } from './cloud'
import { ALL_EVENTS, buy, type Card, CHALLENGE_PAY, challengeFor, fitLook, setLiveryDetail, WEEKLY_PAY, leaderOpen, MEDAL_NAMES, rewardCards, takeCard, type EventDef, type EventKind, loadProgress, type Outcome, type Progress, saveProgress, settle, TIERS, tidy, tierOpen, upgrade, WINS_TO_UNLOCK, winsIn } from './career'
import { type EventSpec, formatTime, Game, ordinal, REPLAY_CAMERAS, type Settings, TOOL_INFO } from './game'
import { COP_TOOL_IDS, type CopToolId, type RacerToolId, TOOL_IDS, type ToolId } from './sim/race'
import type { Weather } from './render/atmosphere'
import type { Quality } from './render/world'
import { carById, CARS, type Rating, ratings } from './sim/cars'
import { bindPedals, bindWheel, startTilt, stopTilt } from './touch'
import { dailySeed, weeklySeed } from './sim/track'
import { FINISHES, fullLooks, GLOWS, isFree, LIVERIES, type LookKind, lookKey, lookName, type Looks, priceOfLook, TRIMS, type Trim } from './looks'
import { classOf, kmh, type Part, PARTS, partById, priceOf, ratingOf, STAGES, stageOf, tuned } from './upgrades'

const $ = (id: string) => document.getElementById(id) as HTMLElement
const params = new URLSearchParams(location.search)
// On a game portal the links that leave the game are hidden (see portal.ts).
if (PORTAL) {
  document.body.classList.add('portal')
  const credit = document.querySelector('.credit')
  if (credit) credit.textContent = 'Built by Ravi Kumar Gupta.'
}
// Paint: deep, saturated car colours rather than neon, so they hold up in
// daylight.
const COLORS = ['#f2a900', '#c8102e', '#0d47a1', '#ff5a1f', '#1f6f4a', '#e9e9ec', '#111316', '#6a1b9a']
const STORE = 'neon-apex/settings'
const KINDS: EventKind[] = ['race', 'elimination', 'drift', 'pursuit', 'trial', 'cop']
const KIND_NOTES: Record<EventKind, string> = {
  race: 'Five rivals. First across the line after the last lap wins. With police on, a patrol car waits by the road.',
  elimination: 'Last place is out at the end of every lap. Be the last car running. With police on, a patrol car waits by the road.',
  drift: 'On your own. Score as many drift points as you can before the laps run out.',
  pursuit: 'Police are on you. Get 300 m clear of every patrol car and stay there.',
  trial: 'On your own against a ghost of your best lap on this track.',
  cop: 'You drive the police car. Four racers get a 3 second start: bust them before they finish, by ramming until their damage is full or by boxing them in. Backup comes on the radio.',
}
const KIND_COLORS: Record<EventKind, string> = { race: '#3df5ff', elimination: '#ff6a3d', drift: '#ffd23d', pursuit: '#ff3d5a', trial: '#a66bff', cop: '#4d7cff' }

function loadSettings(): Settings {
  let saved: Partial<Settings> = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORE) ?? '{}')
  } catch {
    saved = {}
  }
  const coarse = matchMedia('(pointer: coarse)').matches
  return {
    seed: params.get('seed') ?? dailySeed(),
    laps: Number(params.get('laps')) || saved.laps || 3,
    color: saved.color && COLORS.includes(saved.color) ? saved.color : COLORS[0],
    car: saved.car && CARS.some((c) => c.id === saved.car) ? saved.car : CARS[0].id,
    quality: (params.get('quality') as Quality) ?? saved.quality ?? (coarse ? 'low' : 'high'),
    sound: params.has('test') ? false : saved.sound ?? true,
    traffic: saved.traffic ?? true,
    police: saved.police ?? true,
    driftAssist: saved.driftAssist ?? true,
    brakeAssist: saved.brakeAssist ?? false,
    stability: saved.stability ?? true,
    touchSteer: saved.touchSteer === 'arrows' || saved.touchSteer === 'tilt' ? saved.touchSteer : 'wheel',
    leftHanded: saved.leftHanded === true,
    tools: Array.isArray(saved.tools) && saved.tools.length === 2 && saved.tools.every((t) => TOOL_IDS.includes(t)) ? saved.tools : ['shockwave', 'turbo'],
    copTools: Array.isArray(saved.copTools) && saved.copTools.length === 2 && saved.copTools.every((t) => COP_TOOL_IDS.includes(t)) ? saved.copTools : ['spikes', 'pulse'],
    // 'auto' was the old default; it now means the mountain road by day.
    weather: (params.get('weather') as Weather) ?? (saved.weather === 'auto' || !saved.weather ? 'day' : saved.weather),
    kind: saved.kind && KINDS.includes(saved.kind) ? saved.kind : 'race',
  }
}

function saveSettings(s: Settings) {
  try {
    const { seed: _seed, ...rest } = s
    localStorage.setItem(STORE, JSON.stringify(rest))
  } catch {
    // Settings just will not persist.
  }
}

// The first load: a bar of the bytes downloaded so far and what is being
// done. The menu needs fonts, the player's car and the sky; the other cars
// download in the background while the menu is up.
const later = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const MB = (n: number) => (n / 1048576).toFixed(1)
onLoadProgress((r) => {
  $('load-step').textContent = r.step
  $('load-fill').style.transform = `scaleX(${r.total > 0 ? Math.min(1, r.done / r.total).toFixed(3) : 0})`
  $('load-bytes').textContent = r.total > 0 ? `${MB(r.done)} of ${MB(r.total)} MB` : ''
})
setStep('Getting things ready')
// Fonts are drawn into canvas textures (signs, the start banner), so they
// have to be loaded before the city is built.
await document.fonts.load('700 italic 40px "Chakra Petch"').catch(() => undefined)
await document.fonts.load('700 40px "Chakra Petch"').catch(() => undefined)

const settings = loadSettings()
// The player's own car first, then the rest in the background. If the
// first one is slow or fails, the game goes on with a drawn car rather
// than waiting for ever. The browser tests wait for every model, so each
// test starts from the same state.
setStep('Downloading the cars')
const cars = loadCarAssets(carById(settings.car).shape)
await Promise.race([params.has('test') ? cars.all : cars.first, later(20000)])
// The daytime sky photo, so the first race by day has it at once.
setStep('Loading the sky')
await Promise.race([fetchBytes(`${import.meta.env.BASE_URL}textures/sky.hdr`).catch(() => undefined), later(15000)])

let progress: Progress = loadProgress()
// Saves locally, and to the account when signed in.
function keep() {
  saveProgress(progress)
  if (signedIn?.username) uploadProgress(progress)
}
// The player can only drive cars they own.
if (!progress.owned.includes(settings.car)) settings.car = CARS[0].id
// A car's handling with the upgrades fitted to it.
const specFor = (carId: string) => tuned(carById(carId), progress.upgrades[carId])
const coins = (n: number) => n.toLocaleString('en')

let game: Game
try {
  game = new Game($('view') as HTMLCanvasElement, settings, params.has('autopilot'))
} catch {
  // three.js throws when the browser cannot create a WebGL context, for
  // example with hardware acceleration switched off.
  $('loading').textContent = 'This game needs WebGL, and your browser could not start it. Turning on hardware acceleration usually fixes this.'
  throw new Error('WebGL is not available')
}
game.input.bindTouch($('touch'))
// When the other cars arrive, the title screen is rebuilt with them, and a
// car that never came is named in a note on the menu.
void cars.all.then(() => {
  if (game.mode === 'menu') game.showMenu()
  const missing = loadReport().failed.length
  if (missing) {
    $('load-note').textContent = 'Some car models did not download, so simpler drawn cars stand in for them. Reloading the page tries again.'
    $('load-note').classList.remove('hidden')
  }
})
bindWheel($('touch-wheel'), game.input)
bindPedals($('touch-pedals'), game.input)
// Phone steering and layout from Settings. Tilt needs a tap before an
// iPhone will ask for permission, so a saved tilt choice starts on the
// first tap of the visit.
function touchLayout() {
  const touch = $('touch')
  for (const mode of ['wheel', 'arrows', 'tilt']) touch.classList.toggle(`steer-${mode}`, settings.touchSteer === mode)
  touch.classList.toggle('left-handed', settings.leftHanded)
}
touchLayout()
if (settings.touchSteer === 'tilt') window.addEventListener('pointerdown', () => void startTilt(game.input), { once: true })
game.tune = specFor
game.looksFor = (carId) => fullLooks(progress.looks[carId])
// The player's number plates carry their username, or the game's name for
// a guest.
game.plateText = () => (signedIn?.username ?? 'Skidline').toUpperCase()

type Screen = 'menu' | 'quick' | 'career' | 'garage' | 'settings-screen' | 'account' | 'intro' | 'race' | 'results' | 'replay'
const SCREENS = ['menu', 'quick', 'career', 'garage', 'settings-screen', 'account', 'results', 'pause']

function setScreen(screen: Screen) {
  for (const id of SCREENS) $(id).classList.toggle('hidden', id !== screen)
  $('hud').classList.toggle('hidden', screen !== 'race' && screen !== 'results')
  $('intro').classList.toggle('hidden', screen !== 'intro')
  $('replay-ui').classList.toggle('hidden', screen !== 'replay')
  const touch = matchMedia('(pointer: coarse)').matches
  $('touch').classList.toggle('hidden', !(screen === 'race' || screen === 'intro') || !touch)
}

function segmented(id: string, value: string, onPick: (v: string) => void) {
  const root = $(id)
  const mark = (v: string) => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v))
  mark(value)
  root.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      mark(b.dataset.value as string)
      onPick(b.dataset.value as string)
      saveSettings(settings)
    }),
  )
}

// Main menu

function menu() {
  if (game.mode !== 'menu') game.showMenu()
  setScreen('menu')
  const tier = [...TIERS.keys()].filter((k) => tierOpen(progress, k)).pop() ?? 0
  $('career-note').textContent = `${TIERS[tier].name} tier, ${coins(progress.cash)} coins`
  $('garage-note').textContent = carById(settings.car).name
}

$('go-career').addEventListener('click', () => career())
$('go-quick').addEventListener('click', () => quick())
$('go-garage').addEventListener('click', () => garage())

// Photo mode in the garage: the menu goes, the car stops turning, and the
// camera orbits it with a drag, zooms with the wheel or a pinch, and saves
// a picture.
function enterPhoto() {
  document.body.classList.add('photo')
  $('photo-bar').classList.remove('hidden')
  game.enterPhoto()
}
function leavePhoto() {
  if (!document.body.classList.contains('photo')) return
  document.body.classList.remove('photo')
  $('photo-bar').classList.add('hidden')
  game.leavePhoto()
}
$('photo-mode').addEventListener('click', enterPhoto)
$('photo-done').addEventListener('click', leavePhoto)
$('photo-save').addEventListener('click', async () => {
  const car = carById(viewing)
  const blob = await game.snapshot(car.name)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `skidline-${car.id}.png`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') leavePhoto()
})
const touching = new Map<number, { x: number; y: number }>()
const spread = () => {
  const [a, b] = [...touching.values()]
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}
$('view').addEventListener('pointerdown', (e) => {
  if (!game.garage.photo) return
  touching.set(e.pointerId, { x: e.clientX, y: e.clientY })
  $('view').setPointerCapture(e.pointerId)
})
$('view').addEventListener('pointermove', (e) => {
  const was = touching.get(e.pointerId)
  if (!was || !game.garage.photo) return
  const before = spread()
  touching.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (touching.size === 1) game.orbit(e.clientX - was.x, e.clientY - was.y)
  else if (before > 0) game.zoom(before / Math.max(1, spread()))
})
const lift = (e: PointerEvent) => touching.delete(e.pointerId)
$('view').addEventListener('pointerup', lift)
$('view').addEventListener('pointercancel', lift)
$('view').addEventListener(
  'wheel',
  (e) => {
    if (!game.garage.photo) return
    e.preventDefault()
    game.zoom(Math.exp(e.deltaY * 0.0012))
  },
  { passive: false },
)
$('go-settings').addEventListener('click', () => setScreen('settings-screen'))
$('go-account').addEventListener('click', () => openAccount())
document.querySelectorAll('.back').forEach((b) =>
  b.addEventListener('click', () => {
    leavePhoto()
    menu()
  }),
)

// Quick race

function trackLabel() {
  const daily = settings.seed === dailySeed()
  const weekly = settings.seed === weeklySeed()
  const random = settings.seed.startsWith('random-')
  $('track-name').textContent = daily ? `Today's track` : weekly ? `This week's track` : random ? `Track ${settings.seed.replace(/^random-/, '#')}` : `Track "${settings.seed}"`
  $('tonight').classList.toggle('hidden', daily)
  $('weekly').classList.toggle('hidden', weekly)
  // Today's challenge, the same for everyone, once a day.
  const today = dailySeed().slice('night-'.length)
  const done = progress.challengeDay === today
  $('challenge-note').textContent = `Today's challenge: ${challengeFor(today).text}. ${done ? 'Done today.' : `${coins(CHALLENGE_PAY)} coins, once a day.`} This week's track pays ${coins(WEEKLY_PAY)} for your first finished run of the week.`
  const url = new URL(location.href)
  if (daily) url.searchParams.delete('seed')
  else url.searchParams.set('seed', settings.seed)
  history.replaceState(null, '', url)
}

function quickKind(kind: EventKind) {
  settings.kind = kind
  $('kind-note').textContent = KIND_NOTES[kind]
  $('laps-row').classList.toggle('hidden', kind === 'elimination' || kind === 'pursuit')
  $('tools-row').classList.toggle('hidden', kind !== 'pursuit' && kind !== 'cop')
  $('tools-note').classList.toggle('hidden', kind !== 'pursuit' && kind !== 'cop')
  drawTools()
}

// Two tools: racer tools for pursuits, quick or career, and police tools
// for playing the cop. Picking a third drops the one picked longest ago.
function drawTools() {
  const cop = settings.kind === 'cop'
  const ids: ToolId[] = cop ? COP_TOOL_IDS : TOOL_IDS
  const chosen: ToolId[] = cop ? settings.copTools : settings.tools
  const box = $('tools-pick')
  box.innerHTML = ''
  for (const id of ids) {
    const b = document.createElement('button')
    b.dataset.tool = id
    b.textContent = TOOL_INFO[id].name
    b.classList.toggle('on', chosen.includes(id))
    b.addEventListener('click', () => {
      if (chosen.includes(id)) return
      if (cop) settings.copTools = [settings.copTools[1], id as CopToolId]
      else settings.tools = [settings.tools[1], id as RacerToolId]
      saveSettings(settings)
      drawTools()
    })
    box.appendChild(b)
  }
  $('tools-note').textContent = chosen.map((t) => `${TOOL_INFO[t].name}: ${TOOL_INFO[t].does}`).join(' ') + ` Keys 1 and 2, or Q and E. Each works twice${cop ? '' : ' in a pursuit'}.`
}
drawTools()

function quick() {
  setScreen('quick')
  trackLabel()
  quickKind(settings.kind)
}

segmented('kind', settings.kind, (v) => quickKind(v as EventKind))
segmented('laps', String(settings.laps), (v) => (settings.laps = Number(v)))
segmented('traffic', settings.traffic ? 'on' : 'off', (v) => (settings.traffic = v === 'on'))
segmented('police', settings.police ? 'on' : 'off', (v) => (settings.police = v === 'on'))
segmented('weather', settings.weather, (v) => {
  settings.weather = v as Weather | 'auto'
  game.showMenu()
})
$('new-track').addEventListener('click', () => {
  settings.seed = `random-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  trackLabel()
  game.showMenu()
})
$('tonight').addEventListener('click', () => {
  settings.seed = dailySeed()
  trackLabel()
  game.showMenu()
})
$('weekly').addEventListener('click', () => {
  settings.seed = weeklySeed()
  trackLabel()
  game.showMenu()
})

function quickSpec(kind: EventKind = settings.kind): EventSpec {
  const solo = kind === 'drift' || kind === 'trial' || kind === 'pursuit'
  return {
    kind,
    title: kind === 'race' ? 'Quick race' : kind === 'trial' ? 'Time trial' : kind === 'cop' ? 'Playing the cop' : `Quick ${kind}`,
    seed: settings.seed,
    laps: settings.laps,
    rivals: solo ? 0 : kind === 'cop' ? 4 : 5,
    skill: 1,
    traffic: settings.traffic && kind !== 'trial' && kind !== 'drift' ? 8 : 0,
    police: kind === 'pursuit' ? 2 : undefined,
    patrols: settings.police && (kind === 'race' || kind === 'elimination') ? 2 : 0,
    weather: settings.weather,
    // Quick drift events aim for 900 points a lap; time trials for a lap
    // within 12% of the reference.
    target: kind === 'drift' ? 900 * settings.laps : kind === 'trial' ? 1.12 : undefined,
  }
}

$('go-race').addEventListener('click', () => begin(quickSpec()))

// Career

function career() {
  setScreen('career')
  $('cash').textContent = coins(progress.cash)
  const box = $('tiers')
  box.innerHTML = ''
  TIERS.forEach((tier, t) => {
    const open = tierOpen(progress, t)
    const col = document.createElement('div')
    col.className = `tier${open ? '' : ' locked'}`
    const need = t > 0 && !open ? `Win ${WINS_TO_UNLOCK} in ${TIERS[t - 1].name} to open` : `${winsIn(progress, t)} of ${tier.events.length} won`
    col.innerHTML = `<h3>${tier.name}<small>${tier.crew} crew, ${need}</small></h3>`
    const medal = (id: string) => {
      const m = progress.medals[id] ?? 0
      return m ? `<span class="medal m${m}" title="${MEDAL_NAMES[m]} medal">${MEDAL_NAMES[m]}</span>` : ''
    }
    for (const e of tier.events) {
      const b = document.createElement('button')
      b.className = `event${progress.won[e.id] ? ' won' : ''}`
      b.dataset.event = e.id
      b.style.setProperty('--kind', KIND_COLORS[e.kind])
      b.disabled = !open
      b.innerHTML = `<b>${e.title}</b><span class="pay">${e.reward.toLocaleString('en')}</span><span class="kind">${e.kind}, ${e.weather}${e.patrols ? ', police' : ''}${e.rivalStage ? `, rivals stage ${e.rivalStage}` : ''} ${medal(e.id)}</span><span class="blurb">${e.blurb}</span>`
      b.addEventListener('click', () => begin(careerSpec(e)))
      col.appendChild(b)
    }
    // The crew's leader, once three of its events are won.
    const l = tier.leader
    const lead = document.createElement('button')
    const ready = open && leaderOpen(progress, t)
    lead.className = `event leader${progress.won[l.id] ? ' won' : ''}`
    lead.dataset.event = l.id
    lead.disabled = !ready
    lead.innerHTML = `<b>${l.title}</b><span class="pay">${l.reward.toLocaleString('en')}</span><span class="kind">crew leader, ${l.weather} ${medal(l.id)}</span><span class="blurb">${ready ? `${l.blurb} Beat ${l.leader} the first time and pick a reward.` : `Win ${WINS_TO_UNLOCK} of ${tier.crew}'s events to race its leader, ${l.leader}.`}</span>`
    lead.addEventListener('click', () => begin(careerSpec(l)))
    col.appendChild(lead)
    box.appendChild(col)
  })
}

function careerSpec(e: EventDef): EventSpec {
  return { kind: e.kind, title: e.title, seed: e.seed, laps: e.laps, rivals: e.rivals, skill: e.skill, traffic: e.traffic, police: e.police, patrols: e.patrols, weather: e.weather, target: e.target, careerId: e.id, rivalStage: e.rivalStage, leader: e.leader, rivalCar: e.rivalCar }
}

// Garage

let viewing = settings.car
let tab: 'cars' | 'upgrades' | 'looks' = 'cars'
// A look being tried on in the garage before it is bought.
let trying: { kind: LookKind; id: string } | null = null
// The part picked on the upgrade tab, whose next stage the bars preview.
let picked: Part = 'engine'
function garage() {
  game.showGarage()
  setScreen('garage')
  viewing = settings.car
  entering = true
  drawGarage()
}

// Motion in the garage (see the end of styles.css): a marker that slides to
// the active tab, options that stagger in when a tab opens, a pulse on
// whatever was just bought, and coins that count to their new value.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
let entering = true
let enterTimer = 0
const tabBar = $('garage-tab')
const tabMarker = document.createElement('span')
tabMarker.className = 'marker'
tabMarker.setAttribute('aria-hidden', 'true')
tabBar.prepend(tabMarker)

function placeTabMarker() {
  const on = tabBar.querySelector<HTMLButtonElement>('button.on')
  if (!on || on.offsetWidth === 0) return
  const first = !tabBar.classList.contains('ready')
  // The first time it appears it is put in place, not slid there.
  if (first) tabMarker.style.transition = 'none'
  tabMarker.style.transform = `translateX(${on.offsetLeft}px) scaleX(${on.offsetWidth / 100})`
  if (first) {
    void tabMarker.offsetWidth
    tabMarker.style.transition = ''
    tabBar.classList.add('ready')
  }
}

let coinTween = 0
function showCoins(el: HTMLElement, to: number) {
  const from = Number(el.dataset.value ?? to)
  el.dataset.value = String(to)
  cancelAnimationFrame(coinTween)
  if (from === to || reduceMotion.matches || el.offsetParent === null) {
    el.textContent = coins(to)
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 450)
    el.textContent = coins(Math.round(from + (to - from) * (1 - (1 - t) ** 3)))
    if (t < 1) coinTween = requestAnimationFrame(step)
  }
  coinTween = requestAnimationFrame(step)
}

function flashBought(selector: string, newPip = false) {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return
  el.classList.add('bought')
  el.addEventListener('animationend', () => el.classList.remove('bought'), { once: true })
  if (newPip) [...el.querySelectorAll('.pips i.on')].at(-1)?.classList.add('new')
}

// After each redraw: the tab marker, and the entrance when a tab has just
// opened. Redraws for a click inside a tab don't replay the entrance.
function afterGarageDraw() {
  placeTabMarker()
  const animated = document.querySelectorAll('#garage .enter, #garage .enter-text')
  animated.forEach((e) => e.classList.remove('enter', 'enter-text'))
  if (!entering) return
  entering = false
  for (const id of ['car-list', 'parts', 'looks', 'car-stats']) {
    const el = $(id)
    if (el.classList.contains('hidden')) continue
    ;[...el.children].forEach((c, k) => (c as HTMLElement).style.setProperty('--i', String(Math.min(k, 10))))
    void el.offsetWidth
    el.classList.add('enter')
  }
  for (const id of ['car-blurb', 'car-speed']) {
    void $(id).offsetWidth
    $(id).classList.add('enter-text')
  }
  window.clearTimeout(enterTimer)
  enterTimer = window.setTimeout(() => document.querySelectorAll('#garage .enter, #garage .enter-text').forEach((e) => e.classList.remove('enter', 'enter-text')), 700)
}

const STAT_NAMES: Record<Rating, string> = { speed: 'Top speed', acceleration: 'Acceleration', grip: 'Grip', drift: 'Drift', braking: 'Braking', nitro: 'Nitro', toughness: 'Toughness' }

// The looks tab: a row of finishes and a row of underglow colours. A free
// or bought look goes straight on the car; one not bought yet is tried on
// the turntable first, and the main button buys it.
function drawLooks(carId: string, owned: boolean, action: HTMLButtonElement) {
  const current = fullLooks(progress.looks[carId])
  const shown: Looks = trying ? { ...current, [trying.kind]: trying.id } : current
  const row = (kind: LookKind, items: { id: string; name: string; price: number }[]) =>
    items
      .map((l) => {
        const have = l.price === 0 || progress.ownedLooks.includes(lookKey(kind, l.id))
        const tryingThis = trying?.kind === kind && trying.id === l.id
        const status = have ? (current[kind] === l.id ? 'On' : l.price === 0 ? 'Free' : 'Owned') : tryingThis ? 'Trying on' : `${coins(l.price)} coins`
        return `<button data-kind="${kind}" data-look="${l.id}" class="${shown[kind] === l.id ? 'on' : ''}">${l.name}<small>${status}</small></button>`
      })
      .join('')
  // The livery's colour and race number are free, so they change at once
  // on a car the player owns.
  const trims =
    shown.livery === 'none'
      ? ''
      : `<span class="label">Livery colour</span><div class="look-row swatches">${TRIMS.map(
          (t) => `<button data-trim="${t.id}" class="${shown.trim === t.id ? 'on' : ''}" ${owned ? '' : 'disabled'} title="${t.name}" aria-label="${t.name}"><i style="background:${t.color}"></i></button>`,
        ).join('')}</div>`
  const number =
    shown.livery === 'number'
      ? `<span class="label">Race number</span><div class="look-row number-row"><button data-number="-1" ${owned ? '' : 'disabled'} aria-label="Lower number">−</button><b>${shown.number}</b><button data-number="1" ${owned ? '' : 'disabled'} aria-label="Higher number">+</button></div>`
      : ''
  $('looks').innerHTML = `<span class="label">Finish</span><div class="look-row">${row('finish', FINISHES)}</div><span class="label">Underglow, seen at night</span><div class="look-row">${row('glow', GLOWS)}</div><span class="label">Livery, with your name on the plates</span><div class="look-row">${row('livery', LIVERIES)}</div>${trims}${number}`
  const preview = () => (trying ? { ...fullLooks(progress.looks[carId]), [trying.kind]: trying.id } : undefined)
  $('looks')
    .querySelectorAll<HTMLButtonElement>('button[data-kind]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.kind as LookKind
        const id = b.dataset.look as string
        const have = isFree(kind, id) || progress.ownedLooks.includes(lookKey(kind, id))
        if (have && owned) {
          const next = fitLook(progress, carId, kind, id)
          if (next) {
            progress = next
            keep()
          }
          trying = null
        } else trying = { kind, id }
        game.refreshGarage(carId, preview())
        drawGarage()
      }),
    )
  const detail = (change: { trim?: Trim; number?: number }) => {
    const next = setLiveryDetail(progress, carId, change)
    if (!next) return
    progress = next
    keep()
    game.refreshGarage(carId, preview())
    drawGarage()
  }
  $('looks')
    .querySelectorAll<HTMLButtonElement>('button[data-trim]')
    .forEach((b) => b.addEventListener('click', () => detail({ trim: b.dataset.trim as Trim })))
  $('looks')
    .querySelectorAll<HTMLButtonElement>('button[data-number]')
    .forEach((b) => b.addEventListener('click', () => detail({ number: ((current.number - 1 + Number(b.dataset.number) + 99) % 99) + 1 })))
  if (!trying) {
    action.textContent = owned ? 'Pick a look to try it' : 'Buy this car to style it'
    action.disabled = true
    return
  }
  const price = priceOfLook(trying.kind, trying.id)
  const name = lookName(trying.kind, trying.id)
  action.textContent = !owned ? 'Buy this car to style it' : progress.cash >= price ? `Buy ${name} for ${coins(price)}` : `${name} needs ${coins(price)} coins`
  action.disabled = !owned || progress.cash < price
}

// Bars for the car as it is, and, when a stage is being looked at, what it
// would change: green for a gain, red for a loss.
function drawStats(now: ReturnType<typeof ratings>, next?: ReturnType<typeof ratings>) {
  $('car-stats').innerHTML = (Object.keys(STAT_NAMES) as Rating[])
    .map((k) => {
      const a = now[k]
      const b = next?.[k] ?? a
      const change = b > a + 0.001 ? 'gain' : b < a - 0.001 ? 'loss' : ''
      return `<div class="stat" data-stat="${k}"><span>${STAT_NAMES[k]}</span><div class="bar"><div class="change ${change}" style="transform:scaleX(${Math.max(a, b).toFixed(3)})"></div><div style="transform:scaleX(${Math.min(a, b).toFixed(3)})"></div></div></div>`
    })
    .join('')
}

function drawGarage() {
  drawGarageBody()
  afterGarageDraw()
}

function drawGarageBody() {
  showCoins($('garage-cash'), progress.cash)
  document.querySelectorAll<HTMLButtonElement>('#garage-tab button').forEach((b) => b.classList.toggle('on', b.dataset.value === tab))
  const upgrading = tab === 'upgrades'
  const styling = tab === 'looks'
  const list = $('car-list')
  list.innerHTML = ''
  for (const car of CARS) {
    const owned = progress.owned.includes(car.id)
    const b = document.createElement('button')
    b.className = car.id === viewing ? 'on' : ''
    b.dataset.car = car.id
    const own = specFor(car.id)
    b.innerHTML = `<b>${car.name} <span class="class">${classOf(own)} ${ratingOf(own)}</span></b><small>${car.id === settings.car ? 'Driving' : owned ? 'Owned' : `${coins(car.price)} coins`}</small>`
    b.addEventListener('click', () => {
      viewing = car.id
      game.refreshGarage(car.id)
      drawGarage()
    })
    list.appendChild(b)
  }
  const car = carById(viewing)
  const owned = progress.owned.includes(car.id)
  const fitted = progress.upgrades[car.id]
  const spec = specFor(car.id)
  // The upgrade tab works on the car picked on the Cars tab; the list is
  // hidden there to leave room for the parts.
  $('car-blurb').textContent = upgrading ? `Upgrades for the ${car.name}` : styling ? `Looks for the ${car.name}. A look you buy works on every car you own.` : car.blurb
  list.classList.toggle('hidden', upgrading || styling)
  $('paint-row').classList.toggle('hidden', upgrading)
  $('parts').classList.toggle('hidden', !upgrading)
  $('part-note').classList.toggle('hidden', !upgrading)
  $('looks').classList.toggle('hidden', !styling)
  $('car-stats').classList.toggle('hidden', styling)
  $('car-speed').classList.toggle('hidden', styling)
  const action = $('car-action') as HTMLButtonElement

  if (styling) {
    drawLooks(car.id, owned, action)
    return
  }
  if (!upgrading) {
    $('car-speed').textContent = `Class ${classOf(spec)} ${ratingOf(spec)}, top speed ${kmh(spec)} km/h`
    drawStats(ratings(spec))
    action.textContent = car.id === settings.car ? 'Driving this one' : owned ? 'Drive this car' : `Buy for ${coins(car.price)}`
    action.disabled = car.id === settings.car || (!owned && progress.cash < car.price)
    return
  }

  // The upgrade tab: one button per part with its stages, and the bars
  // previewing the next stage of the picked part.
  const parts = $('parts')
  parts.innerHTML = ''
  for (const part of PARTS) {
    const stage = stageOf(fitted, part.id)
    const b = document.createElement('button')
    b.className = `part${part.id === picked ? ' on' : ''}`
    b.dataset.part = part.id
    const pips = Array.from({ length: STAGES }, (_, k) => `<i class="${k < stage ? 'on' : ''}"></i>`).join('')
    const next = stage < STAGES ? `Stage ${stage + 1}: ${coins(priceOf(car, part.id, stage + 1))}` : 'Fully upgraded'
    b.innerHTML = `<b>${part.name}</b><span class="pips" aria-label="Stage ${stage} of ${STAGES}">${pips}</span><small>${next}</small>`
    b.addEventListener('click', () => {
      picked = part.id
      drawGarage()
    })
    parts.appendChild(b)
  }
  const part = partById(picked)
  const stage = stageOf(fitted, picked)
  const maxed = stage >= STAGES
  const after = maxed ? spec : tuned(car, { ...fitted, [picked]: stage + 1 })
  const price = maxed ? 0 : priceOf(car, picked, stage + 1)
  const faster = kmh(after) !== kmh(spec) ? `, ${kmh(after)} km/h with stage ${stage + 1}` : ''
  const better = ratingOf(after) !== ratingOf(spec) ? ` (${classOf(after)} ${ratingOf(after)} with stage ${stage + 1})` : ''
  $('car-speed').textContent = `Class ${classOf(spec)} ${ratingOf(spec)}${better}, top speed ${kmh(spec)} km/h${faster}`
  drawStats(ratings(spec), ratings(after))
  $('part-note').textContent = `${part.does}.`
  if (!owned) {
    action.textContent = 'Buy this car to upgrade it'
    action.disabled = true
  } else if (maxed) {
    action.textContent = `${part.name} fully upgraded`
    action.disabled = true
  } else {
    action.textContent = progress.cash >= price ? `Fit stage ${stage + 1} for ${coins(price)}` : `Stage ${stage + 1} needs ${coins(price)} coins`
    action.disabled = progress.cash < price
  }
}

document.querySelectorAll<HTMLButtonElement>('#garage-tab button').forEach((b) =>
  b.addEventListener('click', () => {
    if (tab === b.dataset.value) return
    tab = b.dataset.value as typeof tab
    trying = null
    entering = true
    game.refreshGarage(viewing)
    drawGarage()
  }),
)

$('car-action').addEventListener('click', () => {
  const car = carById(viewing)
  if (tab === 'looks') {
    if (!trying) return
    const next = fitLook(progress, car.id, trying.kind, trying.id)
    if (!next) return
    const { kind, id } = trying
    progress = next
    trying = null
    keep()
    game.refreshGarage(car.id)
    drawGarage()
    flashBought(`#looks button[data-kind="${kind}"][data-look="${id}"]`)
    return
  }
  if (tab === 'upgrades') {
    const fitted = upgrade(progress, car.id, picked)
    if (!fitted) return
    progress = fitted
    keep()
    drawGarage()
    flashBought(`#parts .part[data-part="${picked}"]`, true)
    return
  }
  const buying = !progress.owned.includes(car.id)
  if (buying) {
    const bought = buy(progress, car.id)
    if (!bought) return
    progress = bought
    keep()
  }
  settings.car = car.id
  saveSettings(settings)
  drawGarage()
  if (buying) flashBought(`#car-list button[data-car="${car.id}"]`)
})

const swatches = $('colors')
for (const color of COLORS) {
  const b = document.createElement('button')
  b.style.background = color
  b.setAttribute('aria-label', `Paint colour ${color}`)
  b.classList.toggle('on', color === settings.color)
  b.addEventListener('click', () => {
    settings.color = color
    swatches.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
    saveSettings(settings)
    game.refreshGarage(viewing)
  })
  swatches.appendChild(b)
}

// Settings

segmented('quality', settings.quality, (v) => game.setQuality(v as Quality))
segmented('drift-assist', settings.driftAssist ? 'on' : 'off', (v) => (settings.driftAssist = v === 'on'))
segmented('brake-assist', settings.brakeAssist ? 'on' : 'off', (v) => (settings.brakeAssist = v === 'on'))
segmented('stability', settings.stability ? 'on' : 'off', (v) => (settings.stability = v === 'on'))
segmented('touch-steer', settings.touchSteer, (v) => {
  settings.touchSteer = v as Settings['touchSteer']
  if (v === 'tilt')
    void startTilt(game.input).then((ok) => {
      // No tilt sensor, or permission refused: back to the wheel.
      if (ok) return
      settings.touchSteer = 'wheel'
      saveSettings(settings)
      document.querySelectorAll<HTMLButtonElement>('#touch-steer button').forEach((b) => b.classList.toggle('on', b.dataset.value === 'wheel'))
      touchLayout()
    })
  else stopTilt(game.input)
  touchLayout()
})
segmented('hand', settings.leftHanded ? 'left' : 'right', (v) => {
  settings.leftHanded = v === 'left'
  touchLayout()
})
segmented('sound', settings.sound ? 'on' : 'off', (v) => {
  settings.sound = v === 'on'
  game.sound.setEnabled(settings.sound)
})

// Accounts

let signedIn: Account | null = null

function showAccount() {
  const out = !signedIn
  const setup = Boolean(signedIn?.needsSetup)
  $('acct-out').classList.toggle('hidden', !out)
  $('acct-setup').classList.toggle('hidden', !setup)
  $('acct-in').classList.toggle('hidden', out || setup)
  $('acct-name').textContent = signedIn?.username ?? ''
  $('account-note').textContent = signedIn?.username ? `Signed in as ${signedIn.username}` : setup ? 'Choose a username to finish' : 'Sign in to save on every device'
}

function accountError(error: unknown) {
  $('acct-error').textContent = error instanceof AccountError ? error.message : 'Something went wrong. Try again.'
}

// A signed-in account's save replaces the one on this device. An account
// with no save yet takes this device's progress.
function adopt(account: Account) {
  signedIn = account
  $('acct-error').textContent = ''
  if (account.username) {
    if (account.progress && typeof account.progress.cash === 'number') {
      progress = tidy({ ...loadProgress(), ...account.progress })
      saveProgress(progress)
      if (!progress.owned.includes(settings.car)) settings.car = CARS[0].id
    } else uploadProgress(progress)
  }
  showAccount()
  if (!$('menu').classList.contains('hidden')) menu()
}

function openAccount() {
  setScreen('account')
  showAccount()
  if (!signedIn && cloudEnabled) {
    googleButton($('google-button'), (credential) => {
      signInWithGoogle(credential).then(adopt, accountError)
    }).catch(() => {
      $('google-button').textContent = 'Google sign-in could not load. Check your connection or ad blocker.'
    })
  }
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault()
  signIn(($('login-user') as HTMLInputElement).value, ($('login-pass') as HTMLInputElement).value).then(adopt, accountError)
})
$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const pass = ($('setup-pass') as HTMLInputElement).value
  if (pass !== ($('setup-pass2') as HTMLInputElement).value) {
    $('acct-error').textContent = 'The two passwords do not match.'
    return
  }
  chooseLogin(($('setup-user') as HTMLInputElement).value, pass).then(adopt, accountError)
})
$('sign-out').addEventListener('click', () => {
  void signOut().then(() => {
    signedIn = null
    showAccount()
  })
})
$('go-account').classList.toggle('hidden', !cloudEnabled)
void currentAccount().then((account) => account && adopt(account))

// Running an event

let current: EventSpec | null = null

// Phones. The game is made for landscape. Android browsers can go full
// screen and lock the screen sideways, but only from a tap; iPhone Safari
// cannot lock it at all, so in portrait a screen asks for the phone to be
// turned, and a race in progress pauses until it is.
const touchScreen = matchMedia('(pointer: coarse)').matches
type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void> }
const canLock = touchScreen && document.fullscreenEnabled && typeof (screen.orientation as Lockable | undefined)?.lock === 'function'
async function landscape() {
  if (!canLock || params.has('test') || document.fullscreenElement) return
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    await (screen.orientation as Lockable).lock?.('landscape')
  } catch {
    // The browser said no. The rotate screen still explains what to do.
  }
}
$('go-landscape').classList.toggle('hidden', !canLock)
$('go-landscape').addEventListener('click', () => void landscape())
const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)')

async function begin(spec: EventSpec) {
  // A race started before every car has downloaded waits for them, for up
  // to 20 seconds, with the intro saying so.
  if (carAssetsPending()) {
    setScreen('intro')
    $('intro-kind').textContent = ''
    $('intro-title').textContent = 'Getting things ready'
    $('intro-detail').textContent = 'The cars are still downloading.'
    await Promise.race([cars.all, later(20000)])
  }
  current = spec
  if (touchScreen) void landscape()
  game.start(spec)
  report('race_start', spec.kind, null, { career: Boolean(spec.careerId), laps: spec.laps, car: settings.car, weather: game.weather })
  setScreen('intro')
  const track = game.race.track
  $('intro-kind').textContent = spec.careerId ? `Career, ${spec.kind}` : spec.kind === 'trial' ? 'Time trial' : spec.kind
  $('intro-title').textContent = spec.title
  const size = spec.kind === 'elimination' ? `${spec.rivals + 1} cars` : spec.kind === 'pursuit' ? `${spec.police} patrol cars` : `${spec.laps} ${spec.laps === 1 ? 'lap' : 'laps'}`
  const patrol = spec.patrols ? ', police on patrol' : ''
  $('intro-detail').textContent = `${(track.length / 1000).toFixed(2)} km circuit, ${({ day: 'sunny day', clear: 'clear night', rain: 'rainy night', dusk: 'dusk' } as Record<Weather, string>)[game.weather]}, ${size}${patrol}`
}

// The intro ends itself after a few seconds or on a key press; this keeps
// the screens in step with it.
window.setInterval(() => {
  if (game.mode === 'race' && !$('intro').classList.contains('hidden')) setScreen('race')
  if (portrait.matches) game.pause()
}, 100)

$('resume').addEventListener('click', () => game.resume())
// The phone's pause menu has what a keyboard has keys for.
$('pause-look').addEventListener('click', () => {
  game.resume()
  game.input.lookUntil = performance.now() + 2500
})
$('pause-reset').addEventListener('click', () => {
  game.resume()
  game.input.press('reset')
})
$('touch-pause').addEventListener('click', () => game.pause())
$('touch-camera').addEventListener('click', () => game.input.press('camera'))
$('touch-tool-1').addEventListener('click', () => game.input.press('tool1'))
$('touch-tool-2').addEventListener('click', () => game.input.press('tool2'))
$('restart').addEventListener('click', () => current && begin(current))
$('quit').addEventListener('click', () => {
  game.showMenu()
  menu()
})
$('again').addEventListener('click', () => current && begin(current))
game.onRestart = () => current && begin(current)
$('to-menu').addEventListener('click', () => {
  game.showMenu()
  if (current?.careerId) career()
  else menu()
})

// Results

const cardText = (card: Card) =>
  card.kind === 'coins'
    ? `${coins(card.coins)} coins`
    : card.kind === 'stage'
      ? `A free stage ${card.stage} ${partById(card.part).name.toLowerCase()} for the ${carById(settings.car).name}`
      : (() => {
          const [kind, id] = card.key.split(':') as [LookKind, string]
          const what = kind === 'finish' ? ' finish' : kind === 'glow' ? ' underglow' : ' livery'
          return `${lookName(kind, id)}${what}, free on every car`
        })()

function showCards(tier: number, leaderId: string) {
  const cards = rewardCards(progress, tier, settings.car)
  const box = document.createElement('div')
  box.className = 'cards'
  box.innerHTML = `<p class="pay-head">${TIERS[tier].crew} is beaten. Pick your reward:</p>`
  for (const card of cards) {
    const b = document.createElement('button')
    b.className = 'card'
    b.textContent = cardText(card)
    b.addEventListener('click', () => {
      progress = takeCard(progress, card, settings.car, leaderId)
      keep()
      box.innerHTML = `<p class="pay-head">You took: ${cardText(card)}.</p>`
    })
    box.appendChild(b)
  }
  $('reward').appendChild(box)
}

let resultTimer = 0
function results(outcome: Outcome) {
  setScreen('results')
  const race = game.race
  const spec = current as EventSpec
  const def = spec.careerId ? ALL_EVENTS.find((e) => e.id === spec.careerId) : undefined
  // Coins are paid once per result, when the screen first opens.
  const me = race.player
  const place = race.position(me)
  const closeWin =
    spec.kind === 'race' && place === 1 && me.finishTime !== null && race.racers.some((r) => !r.player && r.finishTime !== null && r.finishTime - (me.finishTime as number) < 0.5)
  const today = dailySeed()
  const paid = settle(
    progress,
    {
      ...outcome,
      kind: spec.kind,
      laps: spec.laps,
      finished: me.finishTime !== null,
      target: spec.target,
      heat: race.pursuit.heat,
      nearMisses: race.nearMissCount,
      cleanLaps: race.cleanLaps,
      closeWin,
      fate: me.fate,
      escapes: race.escapes,
      takedowns: race.takedowns,
      daily: !def && spec.seed === today,
      weekly: !def && spec.seed === weeklySeed() ? spec.seed : undefined,
      challenge: true,
    },
    today.slice(today.indexOf('-') + 1),
    def,
  )
  progress = paid.progress
  keep()
  report('race_end', spec.kind, Math.round(Math.max(0, race.clock)), { career: Boolean(def), place, fate: me.fate, won: paid.result?.won ?? place === 1, coins: paid.total })
  const head = paid.result ? `<p class="pay-head">${paid.result.won ? 'Event won.' : 'Not won yet.'} ${paid.result.summary}</p>` : ''
  const lines = paid.lines.map((l) => `<li><span>${l.label}</span><b>+${coins(l.coins)}</b></li>`).join('')
  $('reward').innerHTML = `${head}<ul class="pay-lines">${lines}</ul><p class="pay-total">+${coins(paid.total)} coins</p>`
  $('reward').classList.remove('hidden')
  // Beating a crew leader the first time: pick one of the reward cards.
  const tierOf = TIERS.findIndex((t) => t.leader.id === def?.id)
  if (def && tierOf >= 0 && paid.result?.won && !progress.claimed.includes(def.id)) showCards(tierOf, def.id)

  const draw = () => {
    const player = race.player
    const place = race.position(player)
    const kind = spec.kind
    let title = ''
    let summary = ''
    if (player.fate === 'busted') title = 'Busted'
    else if (player.fate === 'wrecked') title = 'Wrecked'
    else if (kind === 'race') title = place === 1 ? 'You won' : `You finished ${ordinal(place)}`
    else if (kind === 'elimination') title = player.out ? `Out in ${ordinal(place)}` : 'Last car running'
    else if (kind === 'pursuit') title = race.pursuit.outcome === 'escaped' ? 'Escaped' : 'Busted'
    else if (kind === 'cop') title = race.busts === race.racers.length - 1 ? 'Every racer busted' : `${race.busts} of ${race.racers.length - 1} racers busted`
    else if (kind === 'drift') title = `${race.drift.total.toLocaleString('en')} drift points`
    else title = 'Time trial'
    if (kind === 'drift') summary = race.drift.total >= (spec.target ?? 0) ? `Target of ${(spec.target ?? 0).toLocaleString('en')} reached.` : `The target was ${(spec.target ?? 0).toLocaleString('en')}.`
    if (kind === 'pursuit') summary = `Heat ${race.pursuit.heat}, ${race.police.length} patrol cars, ${formatTime(Math.max(0, race.clock))} on the run.`
    if (kind === 'trial') summary = `Target lap ${formatTime(race.line.lapTime * (spec.target ?? 1.12))}.`
    if (player.fate === 'wrecked') summary = 'Too much damage: the car is out of the race. Fewer hits, or armour in the garage, keep it running.'
    if (player.fate === 'busted') summary = 'The police boxed you in. Keep moving when they are close, and get 300 m clear to lose them.'
    $('result-title').textContent = title
    $('result-summary').textContent = summary
    const solo = race.racers.length === 1
    const rows = race.standings().map((r, k) => {
      const time = r.finishTime !== null ? formatTime(r.finishTime) : r.fate ?? (r.out ? 'out' : 'still racing')
      const best = r.lapTimes.length ? formatTime(Math.min(...r.lapTimes)) : 'none'
      return `<tr class="${r.player ? 'you' : ''}"><td>${k + 1}</td><td><span class="dot" style="color:${r.color};background:${r.color}"></span>${r.name}</td><td>${time}</td><td>${best}</td></tr>`
    })
    $('standings').innerHTML = solo && kind !== 'trial' ? '' : `<tr><th>Place</th><th>Driver</th><th>Time</th><th>Best lap</th></tr>${rows.join('')}`
    const best = player.lapTimes.length ? Math.min(...player.lapTimes) : null
    const ref = race.line.lapTime
    $('result-note').textContent =
      kind === 'pursuit'
        ? ''
        : `The racing line on this track, driven at the limit of the grip model, takes ${formatTime(ref)} a lap.` +
          (best !== null ? ` Your best lap was ${formatTime(best)}, ${best >= ref ? `${((best / ref - 1) * 100).toFixed(1)}% slower` : `${((1 - best / ref) * 100).toFixed(1)}% faster`}.` : '')
  }
  draw()
  window.clearInterval(resultTimer)
  resultTimer = window.setInterval(() => (game.mode === 'results' ? draw() : window.clearInterval(resultTimer)), 500)
}
game.onResults = results

// Replay controls

function replayName() {
  $('rp-name').textContent = game.race.racers[game.replayFollow].name
}
$('watch').addEventListener('click', () => {
  game.startReplay()
  setScreen('replay')
  replayName()
})
$('rp-play').addEventListener('click', () => {
  game.replayPlaying = !game.replayPlaying
  $('rp-play').textContent = game.replayPlaying ? 'Pause' : 'Play'
})
$('rp-speed').addEventListener('click', () => {
  const speeds = [1, 0.5, 0.25, 2]
  game.replaySpeed = speeds[(speeds.indexOf(game.replaySpeed) + 1) % speeds.length]
  $('rp-speed').textContent = `${game.replaySpeed}x`
})
$('rp-cam').addEventListener('click', () => {
  game.replayCamera = REPLAY_CAMERAS[(REPLAY_CAMERAS.indexOf(game.replayCamera) + 1) % REPLAY_CAMERAS.length]
  $('rp-cam').textContent = { tv: 'TV', chase: 'Chase', heli: 'Heli', bumper: 'Bumper' }[game.replayCamera]
})
const followStep = (by: number) => {
  const n = game.race.racers.length
  game.replayFollow = (game.replayFollow + by + n) % n
  replayName()
}
$('rp-prev').addEventListener('click', () => followStep(-1))
$('rp-next').addEventListener('click', () => followStep(1))
const scrub = $('rp-time') as HTMLInputElement
scrub.addEventListener('input', () => {
  if (game.replay) game.replayTime = (Number(scrub.value) / 1000) * game.replay.duration
})
window.setInterval(() => {
  if (game.mode === 'replay' && game.replay && document.activeElement !== scrub) scrub.value = String(Math.round((game.replayTime / Math.max(0.01, game.replay.duration)) * 1000))
}, 100)
$('rp-exit').addEventListener('click', () => {
  game.mode = 'results'
  setScreen('results')
})

// The first gesture anywhere unlocks audio.
window.addEventListener('pointerdown', () => game.sound.start(), { once: true })
window.addEventListener('keydown', () => game.sound.start(), { once: true })

game.showMenu()
menu()
// Shaders for the title screen, so its first frame does not stall.
setStep('Warming up the graphics')
if (!params.has('test')) await Promise.race([game.warmUp(), later(8000)])
setStep('Ready')
$('loading').classList.add('done')

// The service worker keeps the big files for the next visit. Not in the
// tests or the dev server, where it would only get in the way.
if ('serviceWorker' in navigator && import.meta.env.PROD && !params.has('test')) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined)
}
report('visit', null, null, { touch: matchMedia('(pointer: coarse)').matches, quality: settings.quality, width: Math.round(innerWidth / 100) * 100 })
startClock()

// Hooks for the browser tests and the screenshot script.
if (params.has('test')) {
  Object.assign(window, {
    __neon: {
      game,
      begin,
      quickSpec,
      careerSpec: (id: string) => careerSpec(ALL_EVENTS.find((e) => e.id === id) as EventDef),
      start: (kind: EventKind = 'race') => begin(quickSpec(kind)),
      progress: () => progress,
      state: () => {
        const race = game.race
        const p = race.player
        return {
          mode: game.mode,
          kind: game.event?.kind,
          phase: race.phase,
          clock: race.clock,
          place: race.position(p),
          lap: race.lapOf(p),
          laps: race.laps,
          speed: Math.hypot(p.car.vx, p.car.vz) * 3.6,
          finished: p.finishTime !== null,
          out: p.out,
          lapTimes: p.lapTimes,
          drift: race.drift.total,
          pursuit: race.pursuit,
          police: race.police.length,
          traffic: race.traffic.length,
          weather: game.weather,
          seed: settings.seed,
        }
      },
    },
  })
}
