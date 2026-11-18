import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700-italic.css'
import '@fontsource/chakra-petch/600-italic.css'
import '@fontsource/chakra-petch/500-italic.css'
import './styles.css'
import { formatTime, Game, type Kind, ordinal, type Settings } from './game'
import type { Quality } from './render/world'
import { dailySeed } from './sim/track'

const $ = (id: string) => document.getElementById(id) as HTMLElement
const params = new URLSearchParams(location.search)
const COLORS = ['#ffd23d', '#ff2d95', '#3df5ff', '#5dff7a', '#ff6a3d', '#e8e8f0']
const STORE = 'neon-apex/settings'

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
    quality: (params.get('quality') as Quality) ?? saved.quality ?? (coarse ? 'low' : 'high'),
    sound: params.has('test') ? false : saved.sound ?? true,
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ laps: s.laps, color: s.color, quality: s.quality, sound: s.sound }))
  } catch {
    // Settings just will not persist.
  }
}

// Fonts are drawn into canvas textures (signs, the start banner), so they
// have to be loaded before the city is built.
await document.fonts.load('700 italic 40px "Chakra Petch"').catch(() => undefined)
await document.fonts.load('700 40px "Chakra Petch"').catch(() => undefined)

const settings = loadSettings()
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

segmented('laps', String(settings.laps), (v) => (settings.laps = Number(v)))
segmented('quality', settings.quality, (v) => game.setQuality(v as Quality))
segmented('sound', settings.sound ? 'on' : 'off', (v) => {
  settings.sound = v === 'on'
  game.sound.setEnabled(settings.sound)
})

const swatches = $('colors')
for (const color of COLORS) {
  const b = document.createElement('button')
  b.style.background = color
  b.setAttribute('aria-label', `Car colour ${color}`)
  b.classList.toggle('on', color === settings.color)
  b.addEventListener('click', () => {
    settings.color = color
    swatches.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
    saveSettings(settings)
    game.showMenu()
  })
  swatches.appendChild(b)
}

function setScreen(screen: 'menu' | 'race' | 'results') {
  $('menu').classList.toggle('hidden', screen !== 'menu')
  $('results').classList.toggle('hidden', screen !== 'results')
  $('pause').classList.add('hidden')
  $('hud').classList.toggle('hidden', screen === 'menu')
  const touch = matchMedia('(pointer: coarse)').matches
  $('touch').classList.toggle('hidden', screen !== 'race' || !touch)
}

let lastKind: Kind = 'race'
function start(kind: Kind) {
  lastKind = kind
  game.start(kind)
  setScreen('race')
}

function menu() {
  game.showMenu()
  setScreen('menu')
  trackLabel()
}

$('go-race').addEventListener('click', () => start('race'))
$('go-trial').addEventListener('click', () => start('trial'))
$('new-track').addEventListener('click', () => {
  settings.seed = `random-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  menu()
})
$('tonight').addEventListener('click', () => {
  settings.seed = dailySeed()
  menu()
})
$('resume').addEventListener('click', () => game.resume())
$('touch-pause').addEventListener('click', () => game.pause())
$('restart').addEventListener('click', () => start(lastKind))
$('quit').addEventListener('click', menu)
$('again').addEventListener('click', () => start(lastKind))
$('to-menu').addEventListener('click', menu)

// The results table keeps updating while the rest of the field finishes.
let resultTimer = 0
function results() {
  setScreen('results')
  const race = game.race
  const draw = () => {
    const player = race.player
    const rows = race.standings().map((r, k) => {
      const time = r.finishTime !== null ? formatTime(r.finishTime) : 'still racing'
      const best = r.lapTimes.length ? formatTime(Math.min(...r.lapTimes)) : 'none'
      return `<tr class="${r.player ? 'you' : ''}"><td>${k + 1}</td><td><span class="dot" style="color:${r.color};background:${r.color}"></span>${r.name}</td><td>${time}</td><td>${best}</td></tr>`
    })
    $('standings').innerHTML = `<tr><th>Place</th><th>Driver</th><th>Time</th><th>Best lap</th></tr>${rows.join('')}`
    const place = race.position(player)
    $('result-title').textContent = game.kind === 'trial' ? 'Time trial' : place === 1 ? 'You won' : `You finished ${ordinal(place)}`
    const best = player.lapTimes.length ? Math.min(...player.lapTimes) : null
    const ref = race.line.lapTime
    const gap = best !== null ? ((best / ref - 1) * 100).toFixed(1) : null
    $('result-note').textContent =
      `The racing line on this track, driven at the limit of the grip model, takes ${formatTime(ref)} a lap.` +
      (best !== null ? ` Your best lap was ${formatTime(best)}, ${Number(gap) >= 0 ? `${gap}% slower` : `${Math.abs(Number(gap))}% faster`}.` : '') +
      (game.driftTotal > 0 ? ` Drift points: ${game.driftTotal.toLocaleString('en')}.` : '')
  }
  draw()
  window.clearInterval(resultTimer)
  resultTimer = window.setInterval(() => (game.mode === 'results' ? draw() : window.clearInterval(resultTimer)), 500)
}
game.onResults = results

// The first gesture anywhere unlocks audio.
window.addEventListener('pointerdown', () => game.sound.start(), { once: true })
window.addEventListener('keydown', () => game.sound.start(), { once: true })

menu()
$('loading').classList.add('done')

// Hooks for the browser tests and the screenshot script.
if (params.has('test')) {
  Object.assign(window, {
    __neon: {
      game,
      start,
      state: () => {
        const race = game.race
        const p = race.player
        return {
          mode: game.mode,
          kind: game.kind,
          phase: race.phase,
          clock: race.clock,
          place: race.position(p),
          lap: race.lapOf(p),
          laps: race.laps,
          speed: Math.hypot(p.car.vx, p.car.vz) * 3.6,
          finished: p.finishTime !== null,
          lapTimes: p.lapTimes,
          seed: settings.seed,
        }
      },
    },
  })
}
