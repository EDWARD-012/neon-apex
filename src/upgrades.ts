import type { Progress } from './career'
import type { CarSpec } from './sim/car'
import type { CarDef } from './sim/cars'

// Upgrades: eight parts, three stages each. A stage changes real numbers
// in the car's spec, so an upgraded car is quicker in the physics, not just
// on a bar. The engine and brake steps and the price of each stage come
// from the plan; the rest are first guesses to tune in play.

export type Part = 'engine' | 'gearbox' | 'nitro' | 'tyres' | 'brakes' | 'suspension' | 'weight' | 'armour'

// Stage fitted per part, for one car. A missing part is stock.
export type Fitted = Partial<Record<Part, number>>

export interface PartDef {
  id: Part
  name: string
  // What a stage does, in a few words, for the upgrade screen.
  does: string
  // Price of stages 1, 2 and 3, as a share of the car's value.
  cost: [number, number, number]
  apply: (spec: CarSpec, stage: number) => CarSpec
}

export const STAGES = 3

export const PARTS: PartDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    does: '+4% top speed and +6% pull for each stage',
    cost: [0.15, 0.3, 0.5],
    apply: (s, n) => ({ ...s, topSpeed: s.topSpeed * (1 + 0.04 * n), engine: s.engine * (1 + 0.06 * n) }),
  },
  {
    id: 'gearbox',
    name: 'Gearbox',
    does: 'Quicker shifts, so +4% pull for each stage',
    cost: [0.1, 0.2, 0.35],
    apply: (s, n) => ({ ...s, engine: s.engine * (1 + 0.04 * n) }),
  },
  {
    id: 'nitro',
    name: 'Nitro',
    does: 'The tank lasts 10% longer and pushes 4% harder for each stage',
    cost: [0.1, 0.2, 0.35],
    apply: (s, n) => ({ ...s, nitroBurn: s.nitroBurn * (1 - 0.1 * n), nitroBoost: s.nitroBoost * (1 + 0.04 * n) }),
  },
  {
    id: 'tyres',
    name: 'Tyres',
    does: 'Street, sport, then semi-slick, with more grip at each step',
    cost: [0.08, 0.16, 0.3],
    apply: (s, n) => ({ ...s, lateralLimit: s.lateralLimit * (1 + 0.04 * n), grip: s.grip * (1 + 0.06 * n) }),
  },
  {
    id: 'brakes',
    name: 'Brakes',
    does: '+8% braking for each stage',
    cost: [0.08, 0.16, 0.25],
    apply: (s, n) => ({ ...s, brake: s.brake * (1 + 0.08 * n) }),
  },
  {
    id: 'suspension',
    name: 'Suspension',
    does: 'Sharper turn-in, 6% more for each stage',
    cost: [0.1, 0.2, 0.3],
    apply: (s, n) => ({ ...s, yawResponse: s.yawResponse * (1 + 0.06 * n) }),
  },
  {
    id: 'weight',
    name: 'Weight',
    does: 'A lighter body pulls and turns in better, but hits hurt a little more',
    cost: [0.12, 0.24, 0.4],
    apply: (s, n) => ({ ...s, engine: s.engine * (1 + 0.04 * n), yawResponse: s.yawResponse * (1 + 0.03 * n), toughness: s.toughness * (1 - 0.08 * n) }),
  },
  {
    id: 'armour',
    name: 'Armour',
    does: 'Walls and police rams do less damage, but it adds weight',
    cost: [0.1, 0.2, 0.3],
    apply: (s, n) => ({ ...s, toughness: s.toughness * (1 + 0.2 * n), engine: s.engine * (1 - 0.015 * n) }),
  },
]

export function partById(id: Part): PartDef {
  return PARTS.find((p) => p.id === id) as PartDef
}

// Upgrade prices follow the car's price, so cheap cars are cheap to tune.
// The starter car costs nothing, so it is priced as if it cost 10,000,
// between the Kite and the Brute it sits between on speed.
export const STARTER_VALUE = 10000
export const valueOf = (car: CarDef) => car.price || STARTER_VALUE

export function stageOf(fitted: Fitted | undefined, part: Part): number {
  const n = fitted?.[part] ?? 0
  return Number.isInteger(n) ? Math.max(0, Math.min(STAGES, n)) : 0
}

// Price of the given stage (1 to 3), rounded to 100.
export function priceOf(car: CarDef, part: Part, stage: number): number {
  return Math.round((valueOf(car) * partById(part).cost[stage - 1]) / 100) * 100
}

// Tuning: sliders on a car the player owns, free to move, each within a
// small range, so a setup changes how the car feels without making it a
// different car. Three need their part at stage 1 or better: gearing the
// gearbox, brake balance the brakes, camber the suspension. Steering lock
// is there from the start.
export type TuneId = 'gearing' | 'brakes' | 'camber' | 'steering'
export type Tune = Record<TuneId, number>
export const STOCK_TUNE: Tune = { gearing: 0, brakes: 0, camber: 0, steering: 0 }

export interface TuneDef {
  id: TuneId
  name: string
  min: number
  max: number
  low: string
  high: string
  needs: Part | null
  does: string
}

export const TUNES: TuneDef[] = [
  { id: 'gearing', name: 'Gearing', min: -1, max: 1, low: 'Pull', high: 'Top speed', needs: 'gearbox', does: 'Shorter gears pull up to 8% harder; longer ones add up to 4% to the top speed. You trade one for the other' },
  { id: 'brakes', name: 'Brake balance', min: -1, max: 1, low: 'Front', high: 'Rear', needs: 'brakes', does: 'Toward the rear the car swings into a drift more easily and stops a little later; toward the front it stays planted' },
  { id: 'camber', name: 'Camber', min: 0, max: 1, low: '0°', high: '−3°', needs: 'suspension', does: 'More negative camber corners up to 5% harder but brakes up to 5% worse in a straight line' },
  { id: 'steering', name: 'Steering lock', min: -1, max: 1, low: 'Less', high: 'More', needs: null, does: 'More lock turns tighter and quicker, up to 10%, but makes the car twitchier' },
]

const round = (v: number) => Math.round(v * 10) / 10

// A car's tuning with every slider present, in range and on a step of 0.1,
// for saves made before tuning or edited by hand.
export function cleanTune(raw: unknown): Tune {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...STOCK_TUNE }
  for (const t of TUNES) {
    const v = Number(r[t.id])
    out[t.id] = Number.isFinite(v) ? round(Math.max(t.min, Math.min(t.max, v))) || 0 : 0
  }
  return out
}

// Whether a slider works on a car with these parts.
export const tuneOpen = (def: TuneDef, fitted: Fitted | undefined) => !def.needs || stageOf(fitted, def.needs) >= 1

// The spec with a setup applied. A slider whose part isn't fitted counts as
// centred.
export function withTune(spec: CarSpec, tune: Tune, fitted: Fitted | undefined): CarSpec {
  const on = (id: TuneId) => (tuneOpen(TUNES.find((t) => t.id === id) as TuneDef, fitted) ? tune[id] : 0)
  const g = on('gearing')
  const b = on('brakes')
  const c = on('camber')
  const s = on('steering')
  return {
    ...spec,
    topSpeed: spec.topSpeed * (1 + 0.04 * g),
    engine: spec.engine * (1 - 0.08 * g),
    driftGrip: spec.driftGrip * (1 - 0.15 * b),
    brake: spec.brake * (1 - 0.06 * Math.max(0, b)) * (1 - 0.05 * c),
    lateralLimit: spec.lateralLimit * (1 + 0.05 * c),
    maxSteer: spec.maxSteer * (1 + 0.1 * s),
    yawResponse: spec.yawResponse * (1 + 0.05 * b) * (1 + 0.06 * s),
  }
}

// The car's spec with its fitted parts, and its tuning if given.
export function tuned(car: CarDef, fitted: Fitted = {}, tune?: Partial<Tune>): CarSpec {
  let spec = car.spec
  for (const part of PARTS) {
    const n = stageOf(fitted, part.id)
    if (n > 0) spec = part.apply(spec, n)
  }
  return tune ? withTune(spec, cleanTune(tune), fitted) : spec
}

// Saves a setup on a car the player owns. Moving the sliders is free.
// The tuning is kept with the car's looks, which already go with the save
// to every device.
export function setTune(progress: Progress, carId: string, tune: Partial<Tune>): Progress | null {
  if (!progress.owned.includes(carId)) return null
  const looks = progress.looks[carId]
  return { ...progress, looks: { ...progress.looks, [carId]: { ...looks, tune: cleanTune({ ...looks?.tune, ...tune }) } } }
}

export const kmh = (spec: CarSpec) => Math.round(spec.topSpeed * 3.6)

// Car classes come from top speed, the bands the plan sets: S from 295
// km/h, A from 270, B from 245, C from 220, D below. A car's class is
// worked out with its upgrades, so a tuned B car can climb into A.
export type CarClass = 'S' | 'A' | 'B' | 'C' | 'D'
export function classOf(spec: CarSpec): CarClass {
  const v = kmh(spec)
  return v >= 295 ? 'S' : v >= 270 ? 'A' : v >= 245 ? 'B' : v >= 220 ? 'C' : 'D'
}

// One number for the whole car, 100 to 999, from top speed, pull, grip and
// braking against the range of the cars stock to fully upgraded. Upgrades
// raise it.
export function ratingOf(spec: CarSpec): number {
  const scale = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  const score = 0.4 * scale(spec.topSpeed, 60, 90) + 0.25 * scale(spec.engine, 13, 30) + 0.25 * scale(spec.lateralLimit, 16, 25) + 0.1 * scale(spec.brake, 20, 34)
  return Math.round(100 + 899 * score)
}
