import type { CarState } from './sim/car'

// Records every car 30 times a second during a race, and plays it back by
// writing the recorded state onto the cars. The renderer then draws them as
// usual, so smoke, skid marks, trails and nitro flames all come back too.

const FIELDS = 9
const RATE = 30

export class Recorder {
  private chunks: Float32Array[] = []
  private current: Float32Array
  private used = 0
  private readonly cars: CarState[]
  frames = 0
  private nextAt = 0

  constructor(cars: CarState[]) {
    this.cars = cars
    this.current = new Float32Array(cars.length * FIELDS * 600)
  }

  // Call after every physics step with the race clock.
  sample(clock: number) {
    if (clock < this.nextAt) return
    this.nextAt = clock + 1 / RATE
    const size = this.cars.length * FIELDS
    if (this.used + size > this.current.length) {
      this.chunks.push(this.current)
      this.current = new Float32Array(this.current.length)
      this.used = 0
    }
    for (const car of this.cars) {
      const flags = (car.nitroOn ? 1 : 0) | (car.drifting ? 2 : 0) | (car.braking ? 4 : 0)
      this.current.set([car.x, car.z, car.heading, car.steer, car.wheelSpin, car.slip, flags, car.vx, car.vz], this.used)
      this.used += FIELDS
    }
    this.frames++
  }

  finish(start: number): Replay {
    const size = this.cars.length * FIELDS
    const all = new Float32Array(this.frames * size)
    let at = 0
    for (const chunk of this.chunks) {
      all.set(chunk, at)
      at += chunk.length
    }
    all.set(this.current.subarray(0, this.used), at)
    return new Replay(all, this.cars, this.frames, start)
  }
}

export class Replay {
  readonly duration: number

  constructor(
    private readonly data: Float32Array,
    private readonly cars: CarState[],
    private readonly frames: number,
    // Race clock of the first frame, so replay time 0 lines up with it.
    readonly start: number,
  ) {
    this.duration = Math.max(0, (frames - 1) / RATE)
  }

  // Puts every car where it was t seconds into the recording.
  apply(t: number) {
    const u = Math.max(0, Math.min(this.frames - 1.001, t * RATE))
    const a = Math.floor(u)
    const f = u - a
    const size = this.cars.length * FIELDS
    this.cars.forEach((car, k) => {
      const i = a * size + k * FIELDS
      const j = i + size
      const lerp = (o: number) => this.data[i + o] + (this.data[j + o] - this.data[i + o]) * f
      car.x = lerp(0)
      car.z = lerp(1)
      car.heading = lerp(2)
      car.steer = lerp(3)
      car.wheelSpin = lerp(4)
      car.slip = lerp(5)
      const flags = this.data[i + 6]
      car.nitroOn = (flags & 1) !== 0
      car.drifting = (flags & 2) !== 0
      car.braking = (flags & 4) !== 0
      car.vx = lerp(7)
      car.vz = lerp(8)
      car.impact = 0
    })
  }
}
