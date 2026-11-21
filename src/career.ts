import type { Weather } from './render/atmosphere'
import { CARS } from './sim/cars'
import { type Fitted, type Part, priceOf, STAGES, stageOf } from './upgrades'

// The career: three tiers of events, and the coins that every event pays.
// Coins buy cars and upgrades, and winning three events in a tier opens
// the next one. Progress is kept in the browser. In the code and the save
// the coins are still called cash, the name they had first.

export type EventKind = 'race' | 'elimination' | 'drift' | 'pursuit' | 'trial' | 'cop'

export interface EventDef {
  id: string
  title: string
  kind: EventKind
  blurb: string
  seed: string
  laps: number
  rivals: number
  skill: number
  traffic: number
  police?: number
  // Races: patrol cars that can chase the player at once.
  patrols?: number
  weather: Weather
  // Drift: points to reach. Time attack: the lap to beat, as a multiple of
  // the track's reference lap.
  target?: number
  // Cash for a first win. Repeat wins and lesser results pay part of it.
  reward: number
}

export interface Tier {
  name: string
  events: EventDef[]
}

export const TIERS: Tier[] = [
  {
    name: 'Street',
    events: [
      { id: 'first-night', title: 'First night', kind: 'race', blurb: 'Three laps against three locals. Finish first.', seed: 'career-harbour', laps: 3, rivals: 3, skill: 0.88, traffic: 0, patrols: 1, weather: 'clear', reward: 2500 },
      { id: 'wet-paint', title: 'Wet paint', kind: 'drift', blurb: 'Two laps on a wet road. Score 1,800 drift points.', seed: 'career-docks', laps: 2, rivals: 0, skill: 1, traffic: 0, weather: 'rain', target: 1800, reward: 2000 },
      { id: 'last-standing', title: 'Last one standing', kind: 'elimination', blurb: 'Last place is out every lap. Be the car still running.', seed: 'career-arcade', laps: 99, rivals: 4, skill: 0.9, traffic: 0, patrols: 1, weather: 'dusk', reward: 3000 },
      { id: 'blue-lights', title: 'Blue lights', kind: 'pursuit', blurb: 'Two patrol cars are on you. Get 300 m clear and stay there.', seed: 'career-overpass', laps: 99, rivals: 0, skill: 1, traffic: 8, police: 2, weather: 'day', reward: 3500 },
    ],
  },
  {
    name: 'Downtown',
    events: [
      { id: 'downpour', title: 'Downpour', kind: 'race', blurb: 'Five rivals, traffic and standing water. Finish first.', seed: 'career-financial', laps: 3, rivals: 5, skill: 0.96, traffic: 6, patrols: 2, weather: 'rain', reward: 4500 },
      { id: 'clock', title: 'Against the clock', kind: 'trial', blurb: 'Set a lap within 12% of the reference lap, up in the mountains.', seed: 'career-boulevard', laps: 3, rivals: 0, skill: 1, traffic: 0, weather: 'day', target: 1.12, reward: 4000 },
      { id: 'heat-rising', title: 'Heat rising', kind: 'pursuit', blurb: 'Three patrol cars in the rain, more on the way.', seed: 'career-tunnels', laps: 99, rivals: 0, skill: 1, traffic: 10, police: 3, weather: 'rain', reward: 6000 },
      { id: 'knockout', title: 'Knockout', kind: 'elimination', blurb: 'Six cars, five eliminations. Quicker rivals this time.', seed: 'career-market', laps: 99, rivals: 5, skill: 0.96, traffic: 0, patrols: 2, weather: 'day', reward: 5500 },
    ],
  },
  {
    name: 'Apex',
    events: [
      { id: 'neon-mile', title: 'Neon mile', kind: 'race', blurb: 'Five laps, the best drivers in the city. Finish first.', seed: 'career-skyline', laps: 5, rivals: 5, skill: 1.0, traffic: 8, patrols: 3, weather: 'clear', reward: 8000 },
      { id: 'sideways', title: 'Sideways', kind: 'drift', blurb: 'Three laps at dusk. Score 6,000 drift points.', seed: 'career-quarry', laps: 3, rivals: 0, skill: 1, traffic: 0, weather: 'dusk', target: 6000, reward: 7000 },
      { id: 'full-alert', title: 'Full alert', kind: 'pursuit', blurb: 'Four patrol cars from the start, rain and heavy traffic.', seed: 'career-ringroad', laps: 99, rivals: 0, skill: 1, traffic: 12, police: 4, weather: 'rain', reward: 10000 },
      { id: 'apex', title: 'Apex', kind: 'race', blurb: 'The final. Five laps at dusk against the quickest field there is.', seed: 'career-apex', laps: 5, rivals: 5, skill: 1.03, traffic: 8, patrols: 3, weather: 'dusk', reward: 15000 },
    ],
  },
]

export const ALL_EVENTS = TIERS.flatMap((t) => t.events)
export const WINS_TO_UNLOCK = 3

export interface Progress {
  cash: number
  owned: string[]
  // Event id to whether it has been won.
  won: Record<string, boolean>
  // Car id to the stage of each part fitted to it.
  upgrades: Record<string, Fitted>
  // The last day (UTC, as in the daily track's seed) the daily bonus was
  // paid, and how many days in a row before it.
  daily: { day: string; streak: number } | null
}

export const fresh = (): Progress => ({ cash: 0, owned: [CARS[0].id], won: {}, upgrades: {}, daily: null })

// Fills in what an older or damaged save is missing.
export function tidy(saved: Partial<Progress>): Progress {
  const object = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const daily = saved.daily
  return {
    ...fresh(),
    ...saved,
    won: object(saved.won) ? (saved.won as Progress['won']) : {},
    upgrades: object(saved.upgrades) ? (saved.upgrades as Progress['upgrades']) : {},
    daily: daily && typeof daily.day === 'string' && Number.isInteger(daily.streak) ? daily : null,
  }
}

// What happened in an event, as the game reports it.
export interface Outcome {
  place?: number
  points?: number
  escaped?: boolean
  bestLap?: number
  referenceLap?: number
  // Playing the cop: racers busted, and how many there were.
  busts?: number
  racers?: number
}

export interface Result {
  won: boolean
  cash: number
  summary: string
}

export function judge(event: EventDef, outcome: Outcome, wonBefore: boolean): Result {
  let won = false
  let share = 0
  let summary = ''
  switch (event.kind) {
    case 'race':
    case 'elimination': {
      const place = outcome.place ?? 99
      won = place === 1
      share = place === 1 ? 1 : place === 2 ? 0.5 : place === 3 ? 0.3 : 0.1
      summary = won ? 'First place.' : `Finished ${place}${['th', 'st', 'nd', 'rd'][place] ?? 'th'}. Only a win counts.`
      break
    }
    case 'drift': {
      const points = outcome.points ?? 0
      won = points >= (event.target ?? 0)
      share = won ? 1 : Math.min(0.4, (points / (event.target ?? 1)) * 0.4)
      summary = `${points.toLocaleString('en')} of ${(event.target ?? 0).toLocaleString('en')} drift points.`
      break
    }
    case 'pursuit': {
      won = outcome.escaped === true
      share = won ? 1 : 0
      summary = won ? 'Escaped.' : 'Busted.'
      break
    }
    case 'trial': {
      const target = (outcome.referenceLap ?? 0) * (event.target ?? 1)
      const best = outcome.bestLap ?? Infinity
      won = best <= target
      share = won ? 1 : 0.15
      summary = `Best lap ${best.toFixed(2)} s against a target of ${target.toFixed(2)} s.`
      break
    }
  }
  // Repeat wins pay a quarter, so the career cannot be farmed on one event.
  const cash = Math.round((event.reward * share * (won && wonBefore ? 0.25 : 1)) / 50) * 50
  return { won, cash, summary }
}

export function record(progress: Progress, event: EventDef, result: Result): Progress {
  return {
    ...progress,
    cash: progress.cash + result.cash,
    won: { ...progress.won, [event.id]: progress.won[event.id] || result.won },
  }
}

export function winsIn(progress: Progress, tier: number): number {
  return TIERS[tier].events.filter((e) => progress.won[e.id]).length
}

export function tierOpen(progress: Progress, tier: number): boolean {
  return tier === 0 || winsIn(progress, tier - 1) >= WINS_TO_UNLOCK
}

// What a finished event pays, beyond the career's own reward.
export interface Run extends Outcome {
  kind: EventKind
  laps: number
  // Crossed the line (or was the last car running).
  finished: boolean
  // Drift points to reach, or the lap to beat as a multiple of the
  // reference lap. Only quick events read it; career events have their own.
  target?: number
  heat: number
  nearMisses: number
  cleanLaps: number
  // Won a race by under half a second.
  closeWin: boolean
  // Out of a race early: wrecked by damage, or busted by the police.
  fate?: 'wrecked' | 'busted' | null
  // The heat each time the player lost the police during a race.
  escapes?: number[]
  // Rivals wrecked, and the heat at each patrol car wrecked.
  takedowns?: { rivals: number; cops: number[] }
  // Run on today's daily track.
  daily: boolean
}

export interface Line {
  label: string
  coins: number
}

const round50 = (n: number) => Math.round(n / 50) * 50

// Getting away from the police pays this much for each heat level, in a
// pursuit or when losing them in a race.
export const ESCAPE_PAY = 1000
// Playing the cop: what each racer busted pays.
export const BUST_PAY = 1000
// Wrecking a rival pays a flat amount, a patrol car more for each heat
// level.
export const TAKEDOWN_PAY = { rival: 300, cop: 500 }

// Quick races and the daily track: 1,000 for a win, 500 for a podium, 200
// for finishing. Those are for three laps; one lap pays a third, five laps
// five thirds, so short races are not the quick way to get rich.
function quickPay(run: Run): Line | null {
  const perLap = (n: number) => round50((n * run.laps) / 3)
  const place = run.place ?? 99
  switch (run.kind) {
    case 'race':
      if (!run.finished) return null
      return place === 1 ? { label: 'Win', coins: perLap(1000) } : place <= 3 ? { label: 'Podium', coins: perLap(500) } : { label: 'Finished', coins: perLap(200) }
    case 'elimination':
      return place === 1 ? { label: 'Last car running', coins: 1000 } : place <= 3 ? { label: 'Podium', coins: 500 } : { label: `Out in ${place}${['th', 'st', 'nd', 'rd'][place] ?? 'th'}`, coins: 200 }
    case 'drift':
      return (run.points ?? 0) >= (run.target ?? Infinity) ? { label: 'Drift target reached', coins: perLap(1000) } : { label: 'Finished', coins: perLap(200) }
    case 'trial': {
      if (run.bestLap === undefined) return null
      const beat = run.bestLap <= (run.referenceLap ?? 0) * (run.target ?? 1)
      return beat ? { label: 'Target lap beaten', coins: perLap(1000) } : { label: 'Lap set', coins: perLap(200) }
    }
    case 'pursuit':
      return run.escaped ? { label: `Escaped at heat ${run.heat}`, coins: ESCAPE_PAY * run.heat } : null
    case 'cop': {
      // 1,000 a bust, and as much again for busting every racer.
      const busts = run.busts ?? 0
      const all = busts > 0 && busts === run.racers
      return busts > 0 ? { label: all ? `Every racer busted (${busts})` : `${busts} ${busts === 1 ? 'racer' : 'racers'} busted`, coins: BUST_PAY * busts + (all ? BUST_PAY : 0) } : null
    }
  }
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Pays out a finished event: the career reward or the quick-race pay, a
// fifth more for a close win, the skills, losing the police, and the first
// run of the day on the daily track. Busted pays nothing, but costs
// nothing. A wrecked car keeps what it earned on the way but gets nothing
// for its place.
export function settle(progress: Progress, run: Run, today: string, event?: EventDef): { progress: Progress; lines: Line[]; total: number; result: Result | null } {
  const lines: Line[] = []
  const busted = (run.kind === 'pursuit' && !run.escaped) || run.fate === 'busted'
  const out = run.fate === 'wrecked' || run.fate === 'busted'
  const judged = event ? judge(event, run, Boolean(progress.won[event.id])) : null
  const result = judged && out ? { won: false, cash: 0, summary: run.fate === 'busted' ? 'Busted by the police.' : 'Wrecked.' } : judged
  // A car that went out gets nothing for its place.
  if (result && !out) {
    if (result.cash > 0) lines.push({ label: result.won ? 'Event won' : 'Event result', coins: result.cash })
  } else if (!result && !out && !busted) {
    const base = quickPay(run)
    if (base && base.coins > 0) lines.push(base)
  }
  if (run.closeWin && lines.length > 0) lines.push({ label: 'Close finish, a fifth more', coins: round50(lines[0].coins * 0.2) })
  if (!busted) {
    const misses = run.nearMisses
    if (misses > 0) lines.push({ label: `${misses} near ${misses === 1 ? 'miss' : 'misses'}`, coins: misses * 50 })
    const points = run.points ?? 0
    if (points >= 10) lines.push({ label: `${points.toLocaleString('en')} drift points`, coins: Math.floor(points / 10) })
    if (run.cleanLaps > 0) lines.push({ label: `${run.cleanLaps} clean ${run.cleanLaps === 1 ? 'lap' : 'laps'}`, coins: run.cleanLaps * 100 })
    const downs = run.takedowns ?? { rivals: 0, cops: [] }
    if (downs.rivals > 0) lines.push({ label: `${downs.rivals} ${downs.rivals === 1 ? 'rival' : 'rivals'} wrecked`, coins: downs.rivals * TAKEDOWN_PAY.rival })
    if (downs.cops.length > 0) lines.push({ label: `${downs.cops.length} patrol ${downs.cops.length === 1 ? 'car' : 'cars'} wrecked`, coins: downs.cops.reduce((sum, h) => sum + TAKEDOWN_PAY.cop * h, 0) })
    const escapes = run.escapes ?? []
    if (escapes.length > 0) lines.push({ label: escapes.length === 1 ? `Lost the police at heat ${escapes[0]}` : `Lost the police ${escapes.length} times`, coins: escapes.reduce((sum, h) => sum + ESCAPE_PAY * h, 0) })
  }
  let daily = progress.daily
  if (run.daily && !busted && daily?.day !== today) {
    const streak = daily?.day === dayBefore(today) ? daily.streak + 1 : 1
    lines.push({ label: streak > 1 ? `Today's track, day ${streak} in a row` : `First run on today's track`, coins: 1000 + 250 * (Math.min(streak, 7) - 1) })
    daily = { day: today, streak }
  }
  const total = lines.reduce((sum, l) => sum + l.coins, 0)
  const won = event && result ? { ...progress.won, [event.id]: progress.won[event.id] || result.won } : progress.won
  return { progress: { ...progress, cash: progress.cash + total, won, daily }, lines, total, result }
}

// Fits the next stage of a part to a car the player owns, if there is
// enough cash. Otherwise returns null.
export function upgrade(progress: Progress, carId: string, part: Part): Progress | null {
  const car = CARS.find((c) => c.id === carId)
  if (!car || !progress.owned.includes(carId)) return null
  const fitted = progress.upgrades[carId] ?? {}
  const stage = stageOf(fitted, part) + 1
  if (stage > STAGES) return null
  const price = priceOf(car, part, stage)
  if (progress.cash < price) return null
  return { ...progress, cash: progress.cash - price, upgrades: { ...progress.upgrades, [carId]: { ...fitted, [part]: stage } } }
}

// Buys a car if there is enough cash, otherwise returns null.
export function buy(progress: Progress, carId: string): Progress | null {
  const car = CARS.find((c) => c.id === carId)
  if (!car || progress.owned.includes(carId) || progress.cash < car.price) return null
  return { ...progress, cash: progress.cash - car.price, owned: [...progress.owned, carId] }
}

const KEY = 'neon-apex/career'

export function loadProgress(): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved && typeof saved.cash === 'number' && Array.isArray(saved.owned)) return tidy(saved)
  } catch {
    // Unreadable: start again.
  }
  return fresh()
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Storage blocked: progress lasts for this visit only.
  }
}
