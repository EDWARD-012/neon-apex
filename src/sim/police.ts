import { type CarInput, type CarState, forwardSpeed } from './car'
import type { RacingLine } from './line'
import type { Track } from './track'

// Police driving. Far from the player a patrol car runs the racing line a
// little over the planned speed to close the gap. Close behind, it aims for
// where the player will be in half a second and tries to ram.

export function chase(cop: CarState, target: CarState, track: Track, line: RacingLine): CarInput {
  const n = track.n
  const i = cop.hint
  const speed = Math.max(0, forwardSpeed(cop))
  const gap = ((target.hint - i + n) % n) * track.spacing
  const targetSlow = Math.hypot(target.vx, target.vz) < 6
  const fx = Math.sin(cop.heading)
  const fz = Math.cos(cop.heading)
  let tx: number
  let tz: number
  let want: number
  if (gap < 45) {
    // Close: go for the predicted position, kept inside the barriers.
    const px = target.x + target.vx * 0.5
    const pz = target.z + target.vz * 0.5
    const j = target.hint
    const side = Math.max(-(track.width / 2 - 1.4), Math.min(track.width / 2 - 1.4, (px - track.x[j]) * track.nx[j] + (pz - track.z[j]) * track.nz[j]))
    const along = (px - track.x[j]) * track.tx[j] + (pz - track.z[j]) * track.tz[j]
    tx = track.x[j] + track.tx[j] * along + track.nx[j] * side
    tz = track.z[j] + track.tz[j] * along + track.nz[j] * side
    // A stopped player gets boxed in: creep up and stop just behind.
    want = targetSlow ? Math.max(0, (gap - 6) * 0.8) : Math.min(line.speed[i] * 1.12, Math.max(forwardSpeed(target) + 9, 18))
  } else if (gap > track.length - 60) {
    // Just overshot the player: back off and let them come.
    const j = (i + Math.round((8 + speed * 0.4) / track.spacing)) % n
    tx = track.x[j] + line.offset[j] * track.nx[j]
    tz = track.z[j] + line.offset[j] * track.nz[j]
    want = targetSlow ? 0 : 8
  } else {
    const j = (i + Math.round((7 + speed * 0.42) / track.spacing)) % n
    tx = track.x[j] + line.offset[j] * track.nx[j]
    tz = track.z[j] + line.offset[j] * track.nz[j]
    const lead = (i + Math.round((speed * 0.35) / track.spacing)) % n
    want = Math.min(line.speed[i], line.speed[lead]) * 1.08
  }
  const dx = tx - cop.x
  const dz = tz - cop.z
  const angle = Math.atan2(dx * -fz + dz * fx, Math.max(dx * fx + dz * fz, 0.1))
  const diff = want - speed
  return {
    throttle: diff > 0 ? Math.min(1, diff * 0.5 + 0.3) : 0,
    brake: diff < -1 ? Math.min(1, -diff * 0.3) : 0,
    steer: Math.max(-1, Math.min(1, angle * 2.4)),
    handbrake: false,
    nitro: false,
  }
}
