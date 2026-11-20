import { locate, type Track } from './track'

// Arcade car physics on a flat plane. The car keeps a world-space velocity
// and a heading; grip pulls the sideways part of the velocity towards zero.
// Because the velocity is rotated into the new heading only through that
// grip, it lags behind when grip is low, and that lag is the drift.

export type CarSpec = typeof CAR

export const CAR = {
  topSpeed: 72, // m/s, about 260 km/h
  engine: 16, // m/s² at a standstill, fading to zero at top speed
  brake: 26,
  reverseTop: 11,
  // Small enough that the car really gets close to its top speed.
  drag: 0.00015,
  roll: 0.35,
  wheelbase: 2.6,
  maxSteer: 0.55, // rad
  lateralLimit: 19, // m/s², the most sideways pull the tyres give
  grip: 9, // 1/s, how fast sideways velocity dies with full grip
  driftGrip: 1.4,
  yawResponse: 9,
  halfWidth: 1.0,
  // Car-to-car contact treats each car as two circles, one over each axle.
  radius: 1.05,
  axle: 1.25,
  nitroBoost: 1.75,
  nitroTop: 1.22,
  nitroBurn: 0.3, // tank per second
}

// Barriers sit just outside the painted edge of the road.
export const barrierOffset = (track: Track) => track.width / 2 + 0.8

export interface CarInput {
  throttle: number
  brake: number
  // -1 is full left, +1 full right.
  steer: number
  handbrake: boolean
  nitro: boolean
}

export const idle: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }

export interface CarState {
  // Handling numbers for this car. The shared CAR is the default and the
  // one the racing line plans with.
  spec: CarSpec
  x: number
  z: number
  heading: number
  vx: number
  vz: number
  yawRate: number
  nitro: number
  nitroOn: boolean
  // Angle between where the car points and where it is going.
  slip: number
  drifting: boolean
  // Rises after the handbrake comes off, so grip returns over a moment.
  gripRecovery: number
  steer: number
  wheelSpin: number
  braking: boolean
  // Strength of the last barrier hit, for sparks and sound. Read and reset
  // by the renderer.
  impact: number
  hint: number
  // 0 is a fresh car, 1 is as bad as it gets. Damage costs power and top
  // speed. In a pursuit, a car at 1 is wrecked.
  damage: number
  // Hits not yet shown on the model: x, y, z in car space and a strength,
  // repeated. The renderer takes them; only the latest few are kept.
  hits: number[]
}

// Where on the body a hit lands, in car space: +x is the car's left, +z its
// nose, matching the 3D model. dx and dz are the world direction from the
// middle of the car towards the point of impact.
function recordHit(car: CarState, dx: number, dz: number, strength: number) {
  if (strength < 2.5) return
  const c = Math.cos(car.heading)
  const s = Math.sin(car.heading)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const len = Math.hypot(lx, lz) || 1
  car.hits.push((lx / len) * 0.95, 0.55, (lz / len) * 2.25, strength)
  if (car.hits.length > 32) car.hits.splice(0, car.hits.length - 32)
  car.damage = Math.min(1, car.damage + (strength - 2.5) * 0.011)
}

export function createCar(x: number, z: number, heading: number, track: Track, spec: CarSpec = CAR): CarState {
  return {
    spec,
    x,
    z,
    heading,
    vx: 0,
    vz: 0,
    yawRate: 0,
    nitro: 0.4,
    nitroOn: false,
    slip: 0,
    drifting: false,
    gripRecovery: 1,
    steer: 0,
    wheelSpin: 0,
    braking: false,
    impact: 0,
    damage: 0,
    hits: [],
    hint: locate(track, x, z).i,
  }
}

export const forwardSpeed = (car: CarState) => car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading)
export const speedOf = (car: CarState) => Math.hypot(car.vx, car.vz)

export function stepCar(car: CarState, input: CarInput, dt: number, track: Track) {
  const S = car.spec
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  // Right-hand vector when facing along (fx, fz) with y up.
  const rx = -fz
  const rz = fx
  let vf = car.vx * fx + car.vz * fz
  let vr = car.vx * rx + car.vz * rz

  // Nitro burns only while the car is actually rolling forwards.
  car.nitroOn = input.nitro && car.nitro > 0 && vf > 3 && input.throttle > 0
  if (car.nitroOn) car.nitro = Math.max(0, car.nitro - S.nitroBurn * dt)

  // A battered car loses up to 12% of its top speed and 30% of its pull.
  const top = S.topSpeed * (car.nitroOn ? S.nitroTop : 1) * (1 - 0.12 * car.damage)
  const power = 1 - 0.3 * car.damage
  let accel = 0
  if (input.throttle > 0) {
    if (vf >= -0.5) accel += input.throttle * S.engine * power * (car.nitroOn ? S.nitroBoost : 1) * Math.max(0, 1 - vf / top)
    else accel += input.throttle * S.brake
  }
  car.braking = false
  if (input.brake > 0) {
    if (vf > 0.5) {
      accel -= input.brake * S.brake
      car.braking = true
    } else if (vf > -S.reverseTop) {
      accel -= input.brake * S.engine * 0.6
    }
  }
  if (input.handbrake) accel -= Math.sign(vf) * 3
  const resist = S.drag * vf * Math.abs(vf) + S.roll * Math.sign(vf)
  const next = vf + (accel - resist) * dt
  // Rolling resistance alone must not push the car backwards.
  vf = input.throttle === 0 && input.brake === 0 && Math.sign(next) !== Math.sign(vf) ? 0 : next
  vf = Math.max(vf, -S.reverseTop)

  // Steering and grip, as a two-axle ("bicycle") model. Each axle's tyres
  // make a sideways force from their slip angle, the angle between where
  // the wheel points and where it is actually going. The force follows a
  // tyre curve that peaks at a few degrees and then falls away a little,
  // and is capped by friction times the load on that axle. Braking moves
  // load onto the front tyres and accelerating onto the rear. The
  // handbrake locks the rear wheels, which leaves them little sideways
  // grip: that starts a drift, and throttle and countersteer hold it.
  const speed = Math.abs(vf)
  const lock = S.maxSteer * (1 - 0.6 * Math.min(1, speed / S.topSpeed))
  car.steer += (input.steer * lock - car.steer) * Math.min(1, 12 * dt)
  // From here on: y points left, and a positive yaw rate turns left.
  const delta = -car.steer
  let vy = -vr
  let yaw = car.yawRate
  const L = S.wheelbase
  const a = L * 0.47
  const b = L - a
  if (vf < 4) {
    // Parking speeds and reversing: the wheels just roll where they point.
    const target = (vf * Math.tan(delta)) / L
    yaw += (target - yaw) * Math.min(1, 10 * dt)
    vy *= Math.exp(-10 * dt)
  } else {
    // A touch more grip than the racing line plans with, so a car on the
    // planned speed has a little in hand.
    const mu = (S.lateralLimit * 1.08) / 9.81
    const ax = accel - resist
    const loadF = Math.max(0.2, (9.81 * b - ax * 0.35) / L)
    const loadR = Math.max(0.2, (9.81 * a + ax * 0.35) / L)
    // Peak sideways force at about 6 degrees of slip.
    const stiff = 26 * (S.grip / 9)
    // Grip comes back over a moment after the handbrake is let go.
    if (input.handbrake) car.gripRecovery = 0
    else car.gripRecovery = Math.min(1, car.gripRecovery + dt / 0.6)
    // Full throttle with the wheel turned keeps a slide going: the driven
    // rear wheels stay spinning, so their grip never fully comes back.
    if (!input.handbrake && car.gripRecovery < 1 && car.drifting && input.throttle > 0.5 && Math.abs(input.steer) > 0.3) car.gripRecovery = Math.min(car.gripRecovery, 0.5)
    const sliding = car.gripRecovery < 1
    const locked = 0.3 + S.driftGrip / S.grip
    let rear = 1
    if (input.handbrake) rear = locked
    else if (sliding) rear = locked + (1 - locked) * car.gripRecovery
    // The rear tyres are a little stiffer than the front, as on most road
    // cars: the car pushes wide at the limit rather than spinning.
    const curve = (slip: number, load: number, k: number) => mu * load * Math.sin(1.3 * Math.atan(k * slip))
    // Yaw inertia over mass: the square of the radius of gyration.
    const k2 = a * b
    const sub = 3
    const h = dt / sub
    const sideBefore = Math.abs(vy)
    for (let k = 0; k < sub; k++) {
      const slipF = delta - Math.atan2(vy + a * yaw, vf)
      const slipR = -Math.atan2(vy - b * yaw, vf)
      // A rear end already sliding under throttle loses more grip to the
      // driven wheels spinning: power oversteer, which holds a drift.
      const power = sliding && Math.abs(slipR) > 0.09 && input.throttle > 0 ? 1 - 0.28 * input.throttle : 1
      const fyF = curve(slipF, loadF, stiff)
      const fyR = curve(slipR, loadR, stiff * 1.25) * rear * power
      // The world velocity is kept between steps and the body turns under
      // it, so the turning of the frame is already in vf and vy; only the
      // tyre forces are added here.
      vy += (fyF * Math.cos(delta) + fyR) * h
      yaw += ((a * fyF * Math.cos(delta) - b * fyR) / k2) * h
    }
    const bodySlip = Math.atan2(Math.abs(vy), Math.max(vf, 0.1))
    if (sliding && car.drifting && input.throttle > 0) {
      // Drift assist, as racing games have: past about 30 degrees the slide
      // is damped so a held drift does not turn into a spin, and some of
      // the sideways speed the tyres scrub off carries on as forward speed.
      if (bodySlip > 0.55) {
        yaw *= Math.exp(-7 * (bodySlip - 0.55) * dt)
        vy *= Math.exp(-2.5 * (bodySlip - 0.55) * dt)
      }
      vf += Math.max(0, sideBefore - Math.abs(vy)) * 0.35
    }
    // Stability control, off while the handbrake slide lasts: it nudges the
    // yaw towards what the steering asks for, so a car on the limit does
    // not swap ends on its own.
    if (!sliding) {
      const cap = S.lateralLimit / Math.max(vf, 4)
      const target = Math.max(-cap, Math.min(cap, (vf * Math.tan(delta)) / L))
      yaw += (target - yaw) * Math.min(1, 4 * dt)
      vy *= Math.exp(-1.5 * dt)
    }
  }
  vr = -vy
  car.yawRate = yaw
  car.vx = fx * vf + rx * vr
  car.vz = fz * vf + rz * vr
  car.heading += car.yawRate * dt
  car.x += car.vx * dt
  car.z += car.vz * dt

  car.slip = Math.atan2(Math.abs(vr), Math.max(Math.abs(vf), 0.1))
  car.drifting = car.slip > 0.16 && speed > 12
  // Sliding fills the tank, the harder the better, and a clean lap trickles
  // a little in too.
  if (car.drifting) car.nitro = Math.min(1, car.nitro + 0.2 * Math.min(1, car.slip / 0.45) * dt)
  else if (!car.nitroOn) car.nitro = Math.min(1, car.nitro + 0.008 * dt)
  car.wheelSpin += (vf / 0.34) * dt

  collideWithBarriers(car, track)
}

function collideWithBarriers(car: CarState, track: Track) {
  const where = locate(track, car.x, car.z, car.hint)
  car.hint = where.i
  const limit = barrierOffset(track) - car.spec.halfWidth
  if (Math.abs(where.d) <= limit) return
  const side = Math.sign(where.d)
  const nx = track.nx[where.i] * side
  const nz = track.nz[where.i] * side
  // Push back inside the barrier.
  const over = Math.abs(where.d) - limit
  car.x -= nx * over
  car.z -= nz * over
  // Bounce off the part of the velocity going into the wall and scrub some
  // of the rest. A glancing touch costs little, a head-on hit a lot.
  const into = car.vx * nx + car.vz * nz
  if (into > 0) {
    car.vx -= 1.35 * into * nx
    car.vz -= 1.35 * into * nz
    const scrub = Math.max(0.6, 1 - 0.06 * into)
    car.vx *= scrub
    car.vz *= scrub
    car.impact = Math.max(car.impact, into)
    recordHit(car, nx, nz, into)
    // Turn the nose away from the wall.
    car.yawRate *= 0.5
  }
}

// Pushes two overlapping cars apart and trades the part of their velocity
// along the line between them, like two equal masses with a soft bounce.
// Each car is two circles, front and rear, so cars can run side by side a
// metre apart without touching but still hit nose to tail.
export function collideCars(a: CarState, b: CarState): number {
  const reach = a.spec.axle + b.spec.axle + a.spec.radius + b.spec.radius
  if (Math.abs(b.x - a.x) > reach || Math.abs(b.z - a.z) > reach) return 0
  const min = a.spec.radius + b.spec.radius
  let best = 0
  let ux = 0
  let uz = 0
  for (const sa of [-1, 1]) {
    const ax = a.x + Math.sin(a.heading) * a.spec.axle * sa
    const az = a.z + Math.cos(a.heading) * a.spec.axle * sa
    for (const sb of [-1, 1]) {
      const bx = b.x + Math.sin(b.heading) * b.spec.axle * sb
      const bz = b.z + Math.cos(b.heading) * b.spec.axle * sb
      const dist = Math.hypot(bx - ax, bz - az)
      if (dist < min && min - dist > best && dist > 1e-6) {
        best = min - dist
        ux = (bx - ax) / dist
        uz = (bz - az) / dist
      }
    }
  }
  if (best === 0) return 0
  a.x -= (ux * best) / 2
  a.z -= (uz * best) / 2
  b.x += (ux * best) / 2
  b.z += (uz * best) / 2
  const closing = (a.vx - b.vx) * ux + (a.vz - b.vz) * uz
  if (closing <= 0) return 0
  recordHit(a, ux, uz, closing)
  recordHit(b, -ux, -uz, closing)
  const j = closing * 0.6
  a.vx -= j * ux
  a.vz -= j * uz
  b.vx += j * ux
  b.vz += j * uz
  return closing
}
