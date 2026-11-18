import type { Weather } from './render/atmosphere'
import { CARS } from './sim/cars'

// The career: three tiers of events. Winning pays cash, cash buys cars, and
// winning three events in a tier opens the next one. Progress is kept in
// the browser.

export type EventKind = 'race' | 'elimination' | 'drift' | 'pursuit' | 'trial'

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
      { id: 'first-night', title: 'First night', kind: 'race', blurb: 'Three laps against three locals. Finish first.', seed: 'career-harbour', laps: 3, rivals: 3, skill: 0.88, traffic: 0, weather: 'clear', reward: 2500 },
      { id: 'wet-paint', title: 'Wet paint', kind: 'drift', blurb: 'Two laps on a wet road. Score 1,800 drift points.', seed: 'career-docks', laps: 2, rivals: 0, skill: 1, traffic: 0, weather: 'rain', target: 1800, reward: 2000 },
      { id: 'last-standing', title: 'Last one standing', kind: 'elimination', blurb: 'Last place is out every lap. Be the car still running.', seed: 'career-arcade', laps: 99, rivals: 4, skill: 0.9, traffic: 0, weather: 'dusk', reward: 3000 },
      { id: 'blue-lights', title: 'Blue lights', kind: 'pursuit', blurb: 'Two patrol cars are on you. Get 300 m clear and stay there.', seed: 'career-overpass', laps: 99, rivals: 0, skill: 1, traffic: 8, police: 2, weather: 'clear', reward: 3500 },
    ],
  },
  {
    name: 'Downtown',
    events: [
      { id: 'downpour', title: 'Downpour', kind: 'race', blurb: 'Five rivals, traffic and standing water. Finish first.', seed: 'career-financial', laps: 3, rivals: 5, skill: 0.96, traffic: 6, weather: 'rain', reward: 4500 },
      { id: 'clock', title: 'Against the clock', kind: 'trial', blurb: 'Set a lap within 12% of the reference lap.', seed: 'career-boulevard', laps: 3, rivals: 0, skill: 1, traffic: 0, weather: 'dusk', target: 1.12, reward: 4000 },
      { id: 'heat-rising', title: 'Heat rising', kind: 'pursuit', blurb: 'Three patrol cars in the rain, more on the way.', seed: 'career-tunnels', laps: 99, rivals: 0, skill: 1, traffic: 10, police: 3, weather: 'rain', reward: 6000 },
      { id: 'knockout', title: 'Knockout', kind: 'elimination', blurb: 'Six cars, five eliminations. Quicker rivals this time.', seed: 'career-market', laps: 99, rivals: 5, skill: 0.96, traffic: 0, weather: 'clear', reward: 5500 },
    ],
  },
  {
    name: 'Apex',
    events: [
      { id: 'neon-mile', title: 'Neon mile', kind: 'race', blurb: 'Five laps, the best drivers in the city. Finish first.', seed: 'career-skyline', laps: 5, rivals: 5, skill: 1.0, traffic: 8, weather: 'clear', reward: 8000 },
      { id: 'sideways', title: 'Sideways', kind: 'drift', blurb: 'Three laps at dusk. Score 6,000 drift points.', seed: 'career-quarry', laps: 3, rivals: 0, skill: 1, traffic: 0, weather: 'dusk', target: 6000, reward: 7000 },
      { id: 'full-alert', title: 'Full alert', kind: 'pursuit', blurb: 'Four patrol cars from the start, rain and heavy traffic.', seed: 'career-ringroad', laps: 99, rivals: 0, skill: 1, traffic: 12, police: 4, weather: 'rain', reward: 10000 },
      { id: 'apex', title: 'Apex', kind: 'race', blurb: 'The final. Five laps at dusk against the quickest field there is.', seed: 'career-apex', laps: 5, rivals: 5, skill: 1.03, traffic: 8, weather: 'dusk', reward: 15000 },
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
}

export const fresh = (): Progress => ({ cash: 0, owned: [CARS[0].id], won: {} })

// What happened in an event, as the game reports it.
export interface Outcome {
  place?: number
  points?: number
  escaped?: boolean
  bestLap?: number
  referenceLap?: number
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
    if (saved && typeof saved.cash === 'number' && Array.isArray(saved.owned)) return { ...fresh(), ...saved }
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
