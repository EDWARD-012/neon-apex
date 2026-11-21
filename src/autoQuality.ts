import type { Quality } from './render/world'

// Automatic graphics quality. In the first seconds of each race the game
// times its frames. If the middle frame time is slower than 40 frames a
// second, high quality drops to low; on low, below 28 frames a second, the
// picture is drawn at a smaller size and scaled up. It only ever steps
// down: a screen that refreshes 60 times a second shows nothing about how
// much faster a machine could go. Picking High or Low in Settings turns it
// off, and picking Auto again starts over from the device's default.

export type QualityMode = 'auto' | Quality

// About two and a half seconds of frames at 60 a second.
export const SAMPLE_FRAMES = 150
export const SLOW_FRAME = 1000 / 40
export const VERY_SLOW_FRAME = 1000 / 28
// The smallest render scale, and the step down each time.
export const MIN_SCALE = 0.7
export const SCALE_STEP = 0.15

// Frames longer than this are a hiccup (a tab switch, a stall while
// something loads), not the frame rate, and are left out.
const HICCUP = 250

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface Level {
  quality: Quality
  scale: number
}

// The level to change to after a sample of frame times in ms, or null to
// stay.
export function verdict(frames: number[], now: Level): Level | null {
  if (frames.length < SAMPLE_FRAMES) return null
  const m = median(frames)
  if (now.quality === 'high' && m > SLOW_FRAME) return { quality: 'low', scale: now.scale }
  if (now.quality === 'low' && m > VERY_SLOW_FRAME && now.scale > MIN_SCALE + 1e-6) {
    return { quality: 'low', scale: Math.max(MIN_SCALE, Math.round((now.scale - SCALE_STEP) * 100) / 100) }
  }
  return null
}

// Collects one race's frame times until there are enough to judge.
export class FrameSampler {
  private frames: number[] = []
  done = false

  reset() {
    this.frames = []
    this.done = false
  }

  // Adds a frame and returns the new level once the sample is complete;
  // after that it ignores frames until reset.
  add(ms: number, now: Level): Level | null {
    if (this.done || !(ms > 0) || ms > HICCUP) return null
    this.frames.push(ms)
    if (this.frames.length < SAMPLE_FRAMES) return null
    this.done = true
    return verdict(this.frames, now)
  }
}
