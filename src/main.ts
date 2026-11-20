import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700-italic.css'
import '@fontsource/chakra-petch/600-italic.css'
import '@fontsource/chakra-petch/500-italic.css'
import './styles.css'
import { AccountError, type Account, chooseLogin, cloudEnabled, currentAccount, googleButton, signIn, signInWithGoogle, signOut, uploadProgress } from './cloud'
import { ALL_EVENTS, buy, type EventDef, type EventKind, judge, loadProgress, type Outcome, type Progress, record, saveProgress, TIERS, tierOpen, WINS_TO_UNLOCK, winsIn } from './career'
import { type EventSpec, formatTime, Game, ordinal, REPLAY_CAMERAS, type Settings } from './game'
import type { Weather } from './render/atmosphere'
import type { Quality } from './render/world'
import { carById, CARS, ratings } from './sim/cars'
import { dailySeed } from './sim/track'

const $ = (id: string) => document.getElementById(id) as HTMLElement
const params = new URLSearchParams(location.search)
const COLORS = ['#ffd23d', '#ff2d95', '#3df5ff', '#5dff7a', '#ff6a3d', '#e8e8f0']
const STORE = 'neon-apex/settings'
const KINDS: EventKind[] = ['race', 'elimination', 'drift', 'pursuit', 'trial']
const KIND_NOTES: Record<EventKind, string> = {
  race: 'Five rivals. First across the line after the last lap wins.',
  elimination: 'Last place is out at the end of every lap. Be the last car running.',
  drift: 'On your own. Score as many drift points as you can before the laps run out.',
  pursuit: 'Police are on you. Get 300 m clear of every patrol car and stay there.',
  trial: 'On your own against a ghost of your best lap on this track.',
}
const KIND_COLORS: Record<EventKind, string> = { race: '#3df5ff', elimination: '#ff6a3d', drift: '#ffd23d', pursuit: '#ff3d5a', trial: '#a66bff' }

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
    weather: (params.get('weather') as Weather) ?? saved.weather ?? 'auto',
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

// Fonts are drawn into canvas textures (signs, the start banner), so they
// have to be loaded before the city is built.
await document.fonts.load('700 italic 40px "Chakra Petch"').catch(() => undefined)
await document.fonts.load('700 40px "Chakra Petch"').catch(() => undefined)

const settings = loadSettings()
let progress: Progress = loadProgress()
// Saves locally, and to the account when signed in.
function keep() {
  saveProgress(progress)
  if (signedIn?.username) uploadProgress(progress)
}
// The player can only drive cars they own.
if (!progress.owned.includes(settings.car)) settings.car = CARS[0].id

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
  $('career-note').textContent = `${TIERS[tier].name} tier, ${progress.cash.toLocaleString('en')} cash`
  $('garage-note').textContent = carById(settings.car).name
}

$('go-career').addEventListener('click', () => career())
$('go-quick').addEventListener('click', () => quick())
$('go-garage').addEventListener('click', () => garage())
$('go-settings').addEventListener('click', () => setScreen('settings-screen'))
$('go-account').addEventListener('click', () => openAccount())
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => menu()))

// Quick race

function trackLabel() {
  const daily = settings.seed === dailySeed()
  const random = settings.seed.startsWith('random-')
  $('track-name').textContent = daily ? `Tonight's track` : random ? `Track ${settings.seed.replace(/^random-/, '#')}` : `Track "${settings.seed}"`
  $('tonight').classList.toggle('hidden', daily)
  const url = new URL(location.href)
  if (daily) url.searchParams.delete('seed')
  else url.searchParams.set('seed', settings.seed)
  history.replaceState(null, '', url)
}

function quickKind(kind: EventKind) {
  settings.kind = kind
  $('kind-note').textContent = KIND_NOTES[kind]
  $('laps-row').classList.toggle('hidden', kind === 'elimination' || kind === 'pursuit')
}

function quick() {
  setScreen('quick')
  trackLabel()
  quickKind(settings.kind)
}

segmented('kind', settings.kind, (v) => quickKind(v as EventKind))
segmented('laps', String(settings.laps), (v) => (settings.laps = Number(v)))
segmented('traffic', settings.traffic ? 'on' : 'off', (v) => (settings.traffic = v === 'on'))
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

function quickSpec(kind: EventKind = settings.kind): EventSpec {
  const solo = kind === 'drift' || kind === 'trial' || kind === 'pursuit'
  return {
    kind,
    title: kind === 'race' ? 'Quick race' : kind === 'trial' ? 'Time trial' : `Quick ${kind}`,
    seed: settings.seed,
    laps: settings.laps,
    rivals: solo ? 0 : 5,
    skill: 1,
    traffic: settings.traffic && kind !== 'trial' && kind !== 'drift' ? 8 : 0,
    police: kind === 'pursuit' ? 2 : undefined,
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
  $('cash').textContent = progress.cash.toLocaleString('en')
  const box = $('tiers')
  box.innerHTML = ''
  TIERS.forEach((tier, t) => {
    const open = tierOpen(progress, t)
    const col = document.createElement('div')
    col.className = `tier${open ? '' : ' locked'}`
    const need = t > 0 && !open ? `Win ${WINS_TO_UNLOCK} in ${TIERS[t - 1].name} to open` : `${winsIn(progress, t)} of ${tier.events.length} won`
    col.innerHTML = `<h3>${tier.name}<small>${need}</small></h3>`
    for (const e of tier.events) {
      const b = document.createElement('button')
      b.className = `event${progress.won[e.id] ? ' won' : ''}`
      b.dataset.event = e.id
      b.style.setProperty('--kind', KIND_COLORS[e.kind])
      b.disabled = !open
      b.innerHTML = `<b>${e.title}</b><span class="pay">${e.reward.toLocaleString('en')}</span><span class="kind">${e.kind}, ${e.weather}</span><span class="blurb">${e.blurb}</span>`
      b.addEventListener('click', () => begin(careerSpec(e)))
      col.appendChild(b)
    }
    box.appendChild(col)
  })
}

function careerSpec(e: EventDef): EventSpec {
  return { kind: e.kind, title: e.title, seed: e.seed, laps: e.laps, rivals: e.rivals, skill: e.skill, traffic: e.traffic, police: e.police, weather: e.weather, target: e.target, careerId: e.id }
}

// Garage

let viewing = settings.car
function garage() {
  game.showGarage()
  setScreen('garage')
  viewing = settings.car
  drawGarage()
}

function drawGarage() {
  $('garage-cash').textContent = progress.cash.toLocaleString('en')
  const list = $('car-list')
  list.innerHTML = ''
  for (const car of CARS) {
    const owned = progress.owned.includes(car.id)
    const b = document.createElement('button')
    b.className = car.id === viewing ? 'on' : ''
    b.dataset.car = car.id
    b.innerHTML = `<b>${car.name}</b><small>${car.id === settings.car ? 'Driving' : owned ? 'Owned' : `${car.price.toLocaleString('en')} cash`}</small>`
    b.addEventListener('click', () => {
      viewing = car.id
      game.refreshGarage(car.id)
      drawGarage()
    })
    list.appendChild(b)
  }
  const car = carById(viewing)
  $('car-blurb').textContent = car.blurb
  const r = ratings(car.spec)
  $('car-stats').innerHTML = (['speed', 'acceleration', 'grip', 'drift'] as const)
    .map((k) => `<div class="stat"><span>${k[0].toUpperCase() + k.slice(1)}</span><div class="bar"><div style="transform:scaleX(${r[k].toFixed(2)})"></div></div></div>`)
    .join('')
  const action = $('car-action') as HTMLButtonElement
  const owned = progress.owned.includes(car.id)
  action.textContent = car.id === settings.car ? 'Driving this one' : owned ? 'Drive this car' : `Buy for ${car.price.toLocaleString('en')}`
  action.disabled = car.id === settings.car || (!owned && progress.cash < car.price)
}

$('car-action').addEventListener('click', () => {
  const car = carById(viewing)
  if (!progress.owned.includes(car.id)) {
    const bought = buy(progress, car.id)
    if (!bought) return
    progress = bought
    keep()
  }
  settings.car = car.id
  saveSettings(settings)
  drawGarage()
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
      progress = { ...loadProgress(), ...account.progress }
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

function begin(spec: EventSpec) {
  current = spec
  if (touchScreen) void landscape()
  game.start(spec)
  setScreen('intro')
  const track = game.race.track
  $('intro-kind').textContent = spec.careerId ? `Career, ${spec.kind}` : spec.kind === 'trial' ? 'Time trial' : spec.kind
  $('intro-title').textContent = spec.title
  const size = spec.kind === 'elimination' ? `${spec.rivals + 1} cars` : spec.kind === 'pursuit' ? `${spec.police} patrol cars` : `${spec.laps} ${spec.laps === 1 ? 'lap' : 'laps'}`
  $('intro-detail').textContent = `${(track.length / 1000).toFixed(2)} km circuit, ${game.weather === 'clear' ? 'clear night' : game.weather}, ${size}`
}

// The intro ends itself after a few seconds or on a key press; this keeps
// the screens in step with it.
window.setInterval(() => {
  if (game.mode === 'race' && !$('intro').classList.contains('hidden')) setScreen('race')
  if (portrait.matches) game.pause()
}, 100)

$('resume').addEventListener('click', () => game.resume())
$('touch-pause').addEventListener('click', () => game.pause())
$('restart').addEventListener('click', () => current && begin(current))
$('quit').addEventListener('click', () => {
  game.showMenu()
  menu()
})
$('again').addEventListener('click', () => current && begin(current))
$('to-menu').addEventListener('click', () => {
  game.showMenu()
  if (current?.careerId) career()
  else menu()
})

// Results

let resultTimer = 0
function results(outcome: Outcome) {
  setScreen('results')
  const race = game.race
  const spec = current as EventSpec
  const def = spec.careerId ? ALL_EVENTS.find((e) => e.id === spec.careerId) : undefined
  // The career pays out once per result, when the screen first opens.
  if (def) {
    const result = judge(def, outcome, Boolean(progress.won[def.id]))
    progress = record(progress, def, result)
    keep()
    $('reward').textContent = `${result.won ? 'Event won.' : 'Not won yet.'} ${result.summary} +${result.cash.toLocaleString('en')} cash`
    $('reward').classList.remove('hidden')
  } else $('reward').classList.add('hidden')

  const draw = () => {
    const player = race.player
    const place = race.position(player)
    const kind = spec.kind
    let title = ''
    let summary = ''
    if (kind === 'race') title = place === 1 ? 'You won' : `You finished ${ordinal(place)}`
    else if (kind === 'elimination') title = player.out ? `Out in ${ordinal(place)}` : 'Last car running'
    else if (kind === 'pursuit') title = race.pursuit.outcome === 'escaped' ? 'Escaped' : 'Busted'
    else if (kind === 'drift') title = `${race.drift.total.toLocaleString('en')} drift points`
    else title = 'Time trial'
    if (kind === 'drift') summary = race.drift.total >= (spec.target ?? 0) ? `Target of ${(spec.target ?? 0).toLocaleString('en')} reached.` : `The target was ${(spec.target ?? 0).toLocaleString('en')}.`
    if (kind === 'pursuit') summary = `Heat ${race.pursuit.heat}, ${race.police.length} patrol cars, ${formatTime(Math.max(0, race.clock))} on the run.`
    if (kind === 'trial') summary = `Target lap ${formatTime(race.line.lapTime * (spec.target ?? 1.12))}.`
    $('result-title').textContent = title
    $('result-summary').textContent = summary
    const solo = race.racers.length === 1
    const rows = race.standings().map((r, k) => {
      const time = r.finishTime !== null ? formatTime(r.finishTime) : r.out ? 'out' : 'still racing'
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
$('loading').classList.add('done')

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
