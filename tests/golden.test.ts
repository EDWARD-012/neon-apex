import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type CarInput, createCar, idle, PHYSICS_VERSION, speedOf, stepCar } from '../src/sim/car'
import { CARS } from '../src/sim/cars'
import { Race, STEP } from '../src/sim/race'
import { buildTrack, locate, pointAt } from '../src/sim/track'

// Two guards for the handling, as the plan's feel testing asks: recorded
// laps run in CI, so a change can't quietly break a corner.
//
// 1. A physics fingerprint. Every car runs the same scripted moves, and a
//    hash of where each one ends up is kept in physics-fingerprint.json
//    with the PHYSICS_VERSION it belongs to. Times and ghosts are stored
//    with that version (the leaderboard replays them through the sim), so
//    a change to the handling has to bump it. If this test fails and the
//    change was meant, bump PHYSICS_VERSION in src/sim/car.ts and put the
//    new version and hash (printed in the failure) in the JSON file.
//
// 2. Golden laps: every car driven round three tracks by the AI, with its
//    lap time and how often it touched a wall. A change to the handling,
//    the AI or the tracks that moves these shows up in the snapshot. If it
//    was meant, update it with `npx vitest -u tests/golden.test.ts` and say
//    why in the commit.

const track = buildTrack('feel')
const open = { ...track, width: 1e6 }

type Move = { name: string; speed: number; walls: boolean; input: (t: number) => CarInput; seconds: number }

const MOVES: Move[] = [
  { name: 'launch', speed: 0, walls: false, seconds: 6, input: () => ({ ...idle, throttle: 1 }) },
  { name: 'slalom', speed: 30, walls: false, seconds: 6, input: (t) => ({ ...idle, throttle: 1, steer: Math.sin(t * 2) }) },
  {
    name: 'drift',
    speed: 32,
    walls: false,
    seconds: 5,
    input: (t) => (t < STEP ? { ...idle, throttle: 1, steer: 1, brake: 1, assist: true } : t < 3 ? { ...idle, throttle: 1, steer: 0.7, assist: true } : { ...idle, throttle: 1, assist: true }),
  },
  { name: 'nitro', speed: 20, walls: false, seconds: 4, input: () => ({ ...idle, throttle: 1, nitro: true }) },
  { name: 'brake', speed: 45, walls: false, seconds: 3, input: () => ({ ...idle, brake: 1 }) },
  { name: 'raw', speed: 30, walls: false, seconds: 3, input: (t) => ({ ...idle, throttle: 1, steer: t < 1 ? 0.8 : -0.5, raw: true }) },
  { name: 'wall', speed: 30, walls: true, seconds: 2, input: () => ({ ...idle, throttle: 1 }) },
]

function run(spec: (typeof CARS)[number]['spec'], move: Move) {
  const on = move.walls ? track : open
  const at = pointAt(track, 40, 0)
  let heading = at.heading
  if (move.walls) {
    // Aimed at the right-hand barrier, half a radian off the road's line.
    const i = locate(track, at.x, at.z).i
    const toWall = Math.atan2(track.nx[i], track.nz[i])
    heading += Math.sign(Math.sin(toWall - heading)) * 0.5
  }
  const car = createCar(at.x, at.z, heading, on, spec)
  car.vx = Math.sin(heading) * move.speed
  car.vz = Math.cos(heading) * move.speed
  car.nitro = 1
  for (let t = 0; t < move.seconds; t += STEP) stepCar(car, move.input(t), STEP, on)
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  return [r(car.x - at.x), r(car.z - at.z), r(car.heading), r(speedOf(car)), r(car.damage), r(car.nitro)]
}

// FNV-1a, 32 bits, as hex.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

describe('handling guards', () => {
  it('the physics fingerprint matches PHYSICS_VERSION', () => {
    const states = CARS.map((car) => [car.id, MOVES.map((m) => [m.name, run(car.spec, m)])])
    const now = hash(JSON.stringify(states))
    const kept = JSON.parse(readFileSync(new URL('./physics-fingerprint.json', import.meta.url), 'utf8')) as { version: number; hash: string }
    const help = `Fingerprint for PHYSICS_VERSION ${PHYSICS_VERSION} is ${now}. If the handling changed on purpose, bump PHYSICS_VERSION and write {"version": <new>, "hash": "<new hash>"} to tests/physics-fingerprint.json.`
    expect(kept.version, help).toBe(PHYSICS_VERSION)
    expect(now, help).toBe(kept.hash)
  })

  it('golden laps: every car round three tracks', () => {
    const laps: Record<string, Record<string, [number, number]>> = {}
    for (const seed of ['golden-1', 'golden-2', 'golden-3']) {
      laps[seed] = {}
      for (const car of CARS) {
        const race = new Race({ seed, laps: 1, rivals: 0, autopilot: true, playerSpec: car.spec })
        let walls = 0
        for (let t = 0; t < 300 && race.phase !== 'finished'; t += STEP) {
          race.step()
          if (race.player.car.wallHit > 2) walls++
        }
        const lap = race.player.lapTimes[0]
        expect(lap, `${car.id} on ${seed} finished its lap`).toBeDefined()
        laps[seed][car.id] = [Math.round(lap * 100) / 100, walls]
      }
    }
    expect(laps).toMatchSnapshot()
  })
})
