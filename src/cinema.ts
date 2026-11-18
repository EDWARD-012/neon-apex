import { type PerspectiveCamera, Vector3 } from 'three'
import type { CarState } from './sim/car'
import { pointAt, type Track } from './sim/track'

// Camera moves that are not the player's chase camera: the fly-in before a
// race, the slow orbit when the player finishes, and the trackside TV
// cameras used in replays.

const smooth = (t: number) => t * t * (3 - 2 * t)

function catmull(points: Vector3[], t: number): Vector3 {
  const n = points.length - 1
  const u = Math.min(n - 1e-6, Math.max(0, t * n))
  const i = Math.floor(u)
  const f = u - i
  const p0 = points[Math.max(0, i - 1)]
  const p1 = points[i]
  const p2 = points[i + 1]
  const p3 = points[Math.min(n, i + 2)]
  const f2 = f * f
  const f3 = f2 * f
  const out = new Vector3()
  for (const axis of ['x', 'y', 'z'] as const) {
    out[axis] = 0.5 * (2 * p1[axis] + (-p0[axis] + p2[axis]) * f + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * f2 + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * f3)
  }
  return out
}

export const INTRO_SECONDS = 6

// The fly-in: from high above the road ahead, down along the track, over the
// start gantry and into place behind the player's car.
export function intro(track: Track, player: CarState, t: number, camera: PerspectiveCamera) {
  const at = (s: number, d: number, y: number) => {
    const p = pointAt(track, s, d)
    return new Vector3(p.x, y, p.z)
  }
  const fx = Math.sin(player.heading)
  const fz = Math.cos(player.heading)
  const behind = new Vector3(player.x - fx * 6.8, 2.5, player.z - fz * 6.8)
  const path = [at(340, 30, 70), at(220, -18, 42), at(110, 14, 22), at(30, -6, 11), at(-4, 0, 7.5), behind]
  const looks = [at(240, 0, 0), at(140, 0, 0), at(40, 0, 0), at(-20, 0, 1), new Vector3(player.x, 1, player.z), new Vector3(player.x + fx * 6, 1.2, player.z + fz * 6)]
  const u = smooth(Math.min(1, t / INTRO_SECONDS))
  camera.position.copy(catmull(path, u))
  camera.lookAt(catmull(looks, u))
  camera.fov = 55 + 7 * u
  camera.updateProjectionMatrix()
}

// A slow half orbit round the car, used in slow motion after the finish.
export function finishOrbit(car: CarState, t: number, camera: PerspectiveCamera) {
  const a = car.heading + Math.PI * 0.85 - t * 0.9
  camera.position.set(car.x + Math.sin(a) * 7, 1.6 + t * 0.4, car.z + Math.cos(a) * 7)
  camera.lookAt(car.x, 0.8, car.z)
  camera.fov = 48
  camera.updateProjectionMatrix()
}

// Trackside TV cameras every 90 metres, alternating sides, on poles.
export function tvCameras(track: Track): Vector3[] {
  const out: Vector3[] = []
  const every = 90
  for (let s = 0, k = 0; s < track.length; s += every, k++) {
    const p = pointAt(track, s, (k % 2 === 0 ? 1 : -1) * (track.width / 2 + 7))
    out.push(new Vector3(p.x, 4 + (k % 3), p.z))
  }
  return out
}

// Points the nearest TV camera at the car and zooms so the car fills a
// similar part of the frame whatever its distance.
export function tv(cameras: Vector3[], car: CarState, camera: PerspectiveCamera) {
  let best = cameras[0]
  let bestD = Infinity
  for (const c of cameras) {
    const d = (c.x - car.x) ** 2 + (c.z - car.z) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  const dist = Math.sqrt(bestD + best.y * best.y)
  camera.position.copy(best)
  camera.lookAt(car.x, 0.8, car.z)
  camera.fov = Math.max(14, Math.min(60, (2 * Math.atan(5.5 / dist) * 180) / Math.PI))
  camera.updateProjectionMatrix()
}

// High orbit, like a helicopter shot.
export function heli(car: CarState, time: number, camera: PerspectiveCamera) {
  const a = time * 0.25
  camera.position.set(car.x + Math.sin(a) * 26, 18, car.z + Math.cos(a) * 26)
  camera.lookAt(car.x, 0, car.z)
  camera.fov = 45
  camera.updateProjectionMatrix()
}

// Low on the front bumper, looking forward.
export function bumper(car: CarState, camera: PerspectiveCamera) {
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  camera.position.set(car.x + fx * 2.4, 0.55, car.z + fz * 2.4)
  camera.lookAt(car.x + fx * 30, 0.6, car.z + fz * 30)
  camera.fov = 70
  camera.updateProjectionMatrix()
}
