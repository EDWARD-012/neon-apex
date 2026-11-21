import { CAR, type CarSpec } from './car'

// The cars in the game. Each one is the shared CAR with a few numbers
// changed, so they feel different without needing different physics.

export type Shape = 'vanta' | 'kite' | 'brute' | 'volt' | 'kestrel' | 'sedan' | 'van' | 'police' | 'police-heavy' | 'police-fast'

export interface CarDef {
  id: string
  name: string
  blurb: string
  // Cash needed to unlock it in the career. Zero means owned from the start.
  price: number
  shape: Shape
  spec: CarSpec
}

const make = (changes: Partial<CarSpec>): CarSpec => ({ ...CAR, ...changes })

export const CARS: CarDef[] = [
  {
    id: 'vanta',
    name: 'Vanta GT',
    blurb: 'Balanced. Nothing to fear, nothing it is best at.',
    price: 0,
    shape: 'vanta',
    spec: CAR,
  },
  {
    id: 'kite',
    name: 'Kite RS',
    blurb: 'Light hatch with sticky tyres. Slow on the straights, untouchable in the bends.',
    price: 6000,
    shape: 'kite',
    spec: make({ topSpeed: 66, engine: 17.5, lateralLimit: 21.5, grip: 10.5, driftGrip: 2.2, maxSteer: 0.6 }),
  },
  {
    id: 'brute',
    name: 'Brute V8',
    blurb: 'Muscle car. Huge top speed and a rear end that wants to come round.',
    price: 14000,
    shape: 'brute',
    spec: make({ topSpeed: 78, engine: 15, lateralLimit: 17.5, grip: 7.2, driftGrip: 1.0, nitroBoost: 1.95 }),
  },
  {
    id: 'volt',
    name: 'Volt E',
    blurb: 'Electric. Instant pull off every corner and a nitro tank that lasts.',
    price: 26000,
    shape: 'volt',
    spec: make({ topSpeed: 71, engine: 20, lateralLimit: 19.5, nitroBurn: 0.21, nitroBoost: 1.6 }),
  },
  {
    id: 'kestrel',
    name: 'Kestrel S',
    blurb: 'Light sports coupe. Turns in sharper than any of the others and pulls hard, but it skates when pushed.',
    price: 20000,
    shape: 'kestrel',
    spec: make({ topSpeed: 75, engine: 18, lateralLimit: 19.5, grip: 8.4, driftGrip: 1.2, maxSteer: 0.6, yawResponse: 11 }),
  },
]

export const TRAFFIC_SPEC = make({ topSpeed: 34, engine: 6, lateralLimit: 12, grip: 9 })
export const POLICE_SPEC = make({ topSpeed: 76, engine: 16.5, lateralLimit: 19, grip: 9.5 })
// Heat 3 brings heavy units: slower, but twice the weight and hard to hurt.
export const HEAVY_SPEC = make({ topSpeed: 70, engine: 15, lateralLimit: 17, grip: 9, mass: 2, toughness: 2.5 })
// Heat 5 brings interceptors: quicker than any stock car.
export const INTERCEPTOR_SPEC = make({ topSpeed: 82, engine: 19, lateralLimit: 20, grip: 10, mass: 0.9 })

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0]
}

// Bars for the garage screen, each 0 to 1 across the range of the cars,
// stock to fully upgraded.
export function ratings(spec: CarSpec) {
  const scale = (v: number, lo: number, hi: number) => Math.max(0.08, Math.min(1, (v - lo) / (hi - lo)))
  return {
    speed: scale(spec.topSpeed, 60, 90),
    acceleration: scale(spec.engine, 13, 30),
    grip: scale(spec.lateralLimit, 16, 25),
    drift: scale(1 / spec.driftGrip, 1 / 2.6, 1 / 0.9),
    braking: scale(spec.brake, 20, 34),
    // Boost times how long the tank lasts.
    nitro: scale((spec.nitroBoost - 1) / spec.nitroBurn, 1.5, 6),
    toughness: scale(spec.toughness, 0.7, 1.7),
  }
}

export type Rating = keyof ReturnType<typeof ratings>
