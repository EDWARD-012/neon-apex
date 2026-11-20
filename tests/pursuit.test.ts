import { describe, expect, it } from 'vitest'
import { collideCars, createCar, idle, stepCar } from '../src/sim/car'
import { HEAVY_SPEC, POLICE_SPEC } from '../src/sim/cars'
import { racingLine } from '../src/sim/line'
import { chase } from '../src/sim/police'
import { HEAT_STEP, HELI_ESCAPE, HELI_HEAT, HELI_SIGHT, JAMMER_TIME, MAX_HEAT, MINE_ARM, MINE_DAMAGE, PULSE_LOCK, PULSE_STUN, PUNCTURED, Race, type RaceEvent, ROADBLOCK_GAP, SETUP_AHEAD, SETUP_EVERY, SETUP_HEAT, STEP, type ToolId } from '../src/sim/race'
import { buildTrack, locate, pointAt } from '../src/sim/track'

describe('heat levels', () => {
  it('each level brings its own units: a pair, a heavy unit, a blocker, then interceptors', () => {
    const race = new Race({ seed: 'heat-levels', laps: 99, rivals: 0, mode: 'pursuit', police: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    const events: RaceEvent[] = []
    for (let heat = 2; heat <= MAX_HEAT; heat++) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.player.car.vx = 30
      race.step()
      events.push(...race.events)
      race.events = []
    }
    expect(race.pursuit.heat).toBe(MAX_HEAT)
    expect(events.filter((e) => e.type === 'heatUp').map((e) => (e as { heat: number }).heat)).toEqual([2, 3, 4, 5])
    const kinds = race.police.map((c) => race.copKind.get(c))
    expect(kinds.filter((k) => k === 'heavy')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'interceptor')).toHaveLength(2)
    expect(race.police.filter((c) => race.copRole.get(c) === 'block')).toHaveLength(2)
    expect(events.filter((e) => e.type === 'copJoined')).toHaveLength(race.police.length - 1)
  })

  it('a race never has more police after the player than its limit', () => {
    const race = new Race({ seed: 'heat-race', laps: 3, rivals: 0, patrols: 2 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    race.parked.clear()
    race.chasing = true
    for (let heat = 2; heat <= MAX_HEAT; heat++) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.step()
    }
    expect(race.activeCops.length).toBeLessThanOrEqual(2)
  })
})

describe('weight in collisions', () => {
  it('a heavy unit moves half as much as the patrol car it hits', () => {
    const track = buildTrack('mass')
    const p = pointAt(track, 30, 0)
    const heavy = createCar(p.x, p.z, p.heading, track, HEAVY_SPEC)
    const light = createCar(p.x + Math.sin(p.heading) * 3, p.z + Math.cos(p.heading) * 3, p.heading, track, POLICE_SPEC)
    heavy.vx = Math.sin(p.heading) * 20
    heavy.vz = Math.cos(p.heading) * 20
    collideCars(heavy, light)
    const heavyLoss = 20 - Math.hypot(heavy.vx, heavy.vz)
    const lightGain = Math.hypot(light.vx, light.vz)
    expect(lightGain).toBeCloseTo(heavyLoss * 2, 5)
    expect(light.damage).toBeGreaterThan(heavy.damage)
  })
})

describe('blockers', () => {
  it('a blocker just ahead of the player slows down in its path', () => {
    const track = buildTrack('block')
    const line = racingLine(track)
    const at = (s: number) => pointAt(track, s, 0)
    const me = createCar(at(100).x, at(100).z, at(100).heading, track)
    const cop = createCar(at(120).x, at(120).z, at(120).heading, track, POLICE_SPEC)
    for (const [car, v] of [
      [me, 35],
      [cop, 35],
    ] as const) {
      car.vx = Math.sin(car.heading) * v
      car.vz = Math.cos(car.heading) * v
    }
    const block = chase(cop, me, track, line, 'block')
    const ram = chase(cop, me, track, line, 'ram')
    expect(block.throttle).toBe(0)
    expect(block.brake).toBeGreaterThan(0)
    expect(block).not.toEqual(ram)
    expect(idle.throttle).toBe(0)
  })
})

describe('roadblocks and spike strips', () => {
  const start = (seed: string, traffic = 0) => {
    const race = new Race({ seed, laps: 99, rivals: 0, mode: 'pursuit', police: 1, traffic })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    return race
  }
  const along = (race: Race, x: number, z: number, from: number) => {
    const L = race.track.length
    let ds = locate(race.track, x, z).s - from
    if (ds > L / 2) ds -= L
    if (ds < -L / 2) ds += L
    return ds
  }

  it('from heat 3 a roadblock goes up out of sight ahead, with a gap left open', () => {
    const race = start('roadblock', 8)
    const me = race.player.car
    const from = locate(race.track, me.x, me.z).s
    race.pursuit.heat = SETUP_HEAT
    race.pursuit.sinceJoin = 0
    for (let t = 0; t < SETUP_EVERY + 0.1; t += STEP) {
      race.pursuit.busted = 0
      race.step()
    }
    const events = race.events.map((e) => e.type)
    expect(events).toContain('roadblock')
    expect(race.blockade.length).toBe(2)
    const w = race.track.width
    const across = race.blockade.map((c) => locate(race.track, c.x, c.z).d).sort((a, b) => a - b)
    for (const c of race.blockade) {
      expect(along(race, c.x, c.z, from)).toBeGreaterThan(SETUP_AHEAD - 20)
      expect(race.activeCops).not.toContain(c)
    }
    // The open road left beside the parked cars, which cover about 2.3 m
    // either side of their centres.
    const open = Math.max(across[0] - 2.3 + w / 2, w / 2 - (across[across.length - 1] + 2.3))
    expect(open).toBeGreaterThanOrEqual(ROADBLOCK_GAP - 0.5)
    // Nobody hits them, so they stay where they were put.
    const before = race.blockade.map((c) => [c.x, c.z])
    for (let t = 0; t < 1; t += STEP) race.step()
    race.blockade.forEach((c, k) => expect(Math.hypot(c.x - before[k][0], c.z - before[k][1])).toBeLessThan(0.05))
    // Traffic is moved on rather than left to queue in the gap.
    const at = locate(race.track, race.blockade[0].x, race.blockade[0].z).s
    for (const t of race.traffic) expect(Math.abs(along(race, t.car.x, t.car.z, at))).toBeGreaterThan(40)
  })

  it('a spike strip blows the tyres of a car that crosses it, and only that half of the road', () => {
    const drive = (offset: number) => {
      const race = start('spikes')
      const strip = { s: 200, offset: race.track.width / 4, half: race.track.width / 4 + 0.6 }
      race.spikes.push(strip)
      const me = race.player.car
      const top = me.spec.topSpeed
      const p = pointAt(race.track, 192, offset)
      Object.assign(me, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * 20, vz: Math.cos(p.heading) * 20, yawRate: 0, hint: locate(race.track, p.x, p.z).i })
      race.playerInput = { ...idle, throttle: 1 }
      for (let t = 0; t < 0.8; t += STEP) race.step()
      return { race, top }
    }
    const clean = drive(-quarter())
    expect(clean.race.punctured).toBe(false)
    const hit = drive(quarter())
    expect(hit.race.punctured).toBe(true)
    expect(hit.race.events.map((e) => e.type)).toContain('punctured')
    expect(hit.race.player.car.spec.topSpeed).toBeCloseTo(hit.top * PUNCTURED.topSpeed, 5)
  })
})

// A lane's width in from the centre line, on the strip's side or the other.
const quarter = () => buildTrack('spikes').width / 4

describe('helicopter, units called ahead and the pulse', () => {
  const start = (seed: string) => {
    const race = new Race({ seed, laps: 99, rivals: 0, mode: 'pursuit', police: 1 })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    return race
  }
  const heatTo = (race: Race, heat: number) => {
    while (race.pursuit.heat < heat) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.step()
    }
  }

  it('heat 4 brings a helicopter that closes in, and a blocker called in ahead', () => {
    const race = start('heli')
    const events: RaceEvent[] = []
    heatTo(race, HELI_HEAT)
    events.push(...race.events)
    expect(events.map((e) => e.type)).toContain('heliJoined')
    const heli = race.heli!
    const me = race.player.car
    const far = Math.hypot(heli.x - me.x, heli.z - me.z)
    expect(far).toBeGreaterThan(HELI_SIGHT)
    for (let t = 0; t < 6; t += STEP) {
      race.pursuit.busted = 0
      race.step()
    }
    expect(race.heli!.seeing).toBe(true)
    // The heat 4 blocker starts ahead of the player.
    const blocker = race.police.filter((c) => race.copRole.get(c) === 'block').at(-1)!
    const ahead = (locate(race.track, blocker.x, blocker.z).s - locate(race.track, me.x, me.z).s + race.track.length) % race.track.length
    expect(ahead).toBeLessThan(race.track.length / 2)
  })

  it('the spotlight slows the escape meter', () => {
    const fill = (withHeli: boolean) => {
      const race = start('spotlight')
      heatTo(race, withHeli ? HELI_HEAT : 3)
      const me = race.player.car
      // Every police car far behind, so the escape meter fills.
      const away = pointAt(race.track, locate(race.track, me.x, me.z).s - 450, 0)
      for (const c of race.police) Object.assign(c, away, { vx: 0, vz: 0, hint: locate(race.track, away.x, away.z).i })
      race.pursuit.escape = 0
      for (let t = 0; t < 1.5; t += STEP) {
        if (race.heli) Object.assign(race.heli, { x: me.x, z: me.z })
        for (const c of race.police) Object.assign(c, { vx: 0, vz: 0 })
        race.step()
      }
      return race.pursuit.escape
    }
    const free = fill(false)
    const seen = fill(true)
    expect(free).toBeGreaterThan(0.2)
    expect(seen).toBeCloseTo(free * HELI_ESCAPE, 2)
  })

  it('an interceptor lined up behind locks on and cuts the power', () => {
    const race = start('pulse')
    heatTo(race, MAX_HEAT)
    const me = race.player.car
    const interceptor = race.police.find((c) => race.copKind.get(c) === 'interceptor')!
    const events: RaceEvent[] = []
    for (let t = 0; t < PULSE_LOCK + 0.2; t += STEP) {
      // Keep it 30 m behind on the player's line, every other car away.
      const s = locate(race.track, me.x, me.z).s
      const at = pointAt(race.track, s - 30, locate(race.track, me.x, me.z).d)
      Object.assign(interceptor, { x: at.x, z: at.z, heading: at.heading, hint: locate(race.track, at.x, at.z).i })
      race.pursuit.busted = 0
      race.step()
      events.push(...race.events)
      race.events = []
    }
    expect(events.map((e) => e.type)).toContain('pulseLock')
    expect(events.map((e) => e.type)).toContain('pulsed')
    expect(me.stunned).toBeGreaterThan(0)
    // Cut power: from a standstill it barely pulls away.
    const track = race.track
    const p = pointAt(track, 30, 0)
    const cut = createCar(p.x, p.z, p.heading, track)
    const fresh = createCar(p.x, p.z, p.heading, track)
    cut.stunned = PULSE_STUN
    for (let t = 0; t < 1; t += STEP) {
      stepCar(cut, { ...idle, throttle: 1 }, STEP, track)
      stepCar(fresh, { ...idle, throttle: 1 }, STEP, track)
    }
    expect(Math.hypot(cut.vx, cut.vz)).toBeLessThan(Math.hypot(fresh.vx, fresh.vz) * 0.3)
  })
})

describe('racer tools', () => {
  const start = (tools: ToolId[], seed = 'tools') => {
    const race = new Race({ seed, laps: 99, rivals: 0, mode: 'pursuit', police: 1, tools })
    for (let t = 0; t < 3.1; t += STEP) race.step()
    return race
  }

  it('each of the two tools can be used twice, a second apart', () => {
    const race = start(['turbo', 'mine'])
    expect(race.tools.map((t) => t.id)).toEqual(['turbo', 'mine'])
    expect(race.useTool(0)).toBe(true)
    expect(race.useTool(0)).toBe(false)
    for (let t = 0; t < 1.1; t += STEP) race.step()
    expect(race.useTool(0)).toBe(true)
    for (let t = 0; t < 1.1; t += STEP) race.step()
    expect(race.useTool(0)).toBe(false)
    expect(race.useTool(1)).toBe(true)
    expect(race.useTool(2)).toBe(false)
  })

  it('the jammer hides the player from the helicopter and stops the setups ahead', () => {
    const race = start(['jammer', 'turbo'])
    while (race.pursuit.heat < HELI_HEAT) {
      race.pursuit.sinceJoin = HEAT_STEP + 1
      race.step()
    }
    const me = race.player.car
    race.useTool(0)
    expect(race.jammed).toBe(JAMMER_TIME)
    const roadblocks = race.blockade.length
    for (let t = 0; t < JAMMER_TIME - 0.5; t += STEP) {
      Object.assign(race.heli!, { x: me.x, z: me.z })
      race.pursuit.busted = 0
      race.step()
      expect(race.heli!.seeing).toBe(false)
    }
    expect(race.blockade.length).toBe(roadblocks)
  })

  it('the shockwave throws close cars away from the player', () => {
    const race = start(['shockwave', 'turbo'])
    const me = race.player.car
    const cop = race.police[0]
    const at = pointAt(race.track, locate(race.track, me.x, me.z).s - 8, 0)
    Object.assign(cop, { x: at.x, z: at.z, vx: 0, vz: 0, hint: locate(race.track, at.x, at.z).i })
    race.useTool(0)
    const away = (cop.vx * (cop.x - me.x) + cop.vz * (cop.z - me.z)) / Math.hypot(cop.x - me.x, cop.z - me.z)
    expect(away).toBeGreaterThan(5)
  })

  it('the turbo pushes the car past its top speed', () => {
    const track = buildTrack('turbo')
    const open = { ...track, width: 1e6 }
    const p = pointAt(track, 20, 0)
    const car = createCar(p.x, p.z, p.heading, track)
    for (let t = 0; t < 40; t += STEP) stepCar(car, { ...idle, throttle: 1 }, STEP, open)
    const flat = Math.hypot(car.vx, car.vz)
    car.turbo = 2.5
    for (let t = 0; t < 2.5; t += STEP) stepCar(car, { ...idle, throttle: 1 }, STEP, open)
    expect(Math.hypot(car.vx, car.vz)).toBeGreaterThan(flat * 1.08)
  })

  it('a mine goes off under a police car once it is armed', () => {
    const race = start(['mine', 'turbo'])
    race.useTool(0)
    const mine = race.mines[0]
    const cop = race.police[0]
    // Too soon: not armed yet.
    Object.assign(cop, { x: mine.x, z: mine.z, vx: 0, vz: 0 })
    race.step()
    expect(race.mines).toHaveLength(1)
    for (let t = 0; t < MINE_ARM + 0.1; t += STEP) {
      Object.assign(cop, { x: mine.x + 30, z: mine.z, vx: 0, vz: 0 })
      race.step()
    }
    const events: RaceEvent[] = []
    Object.assign(cop, { x: mine.x, z: mine.z, vx: 0, vz: 0 })
    race.events = []
    race.step()
    events.push(...race.events)
    expect(events.map((e) => e.type)).toContain('mineHit')
    expect(race.mines).toHaveLength(0)
    expect(cop.damage).toBeGreaterThanOrEqual(MINE_DAMAGE / cop.spec.toughness - 0.01)
  })
})
