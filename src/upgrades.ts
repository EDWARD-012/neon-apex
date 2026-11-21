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

// The car's spec with its fitted parts.
export function tuned(car: CarDef, fitted: Fitted = {}): CarSpec {
  let spec = car.spec
  for (const part of PARTS) {
    const n = stageOf(fitted, part.id)
    if (n > 0) spec = part.apply(spec, n)
  }
  return spec
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
