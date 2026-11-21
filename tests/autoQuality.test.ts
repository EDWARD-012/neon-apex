import { describe, expect, it } from 'vitest'
import { FrameSampler, median, MIN_SCALE, SAMPLE_FRAMES, verdict } from '../src/autoQuality'

const frames = (ms: number, n = SAMPLE_FRAMES) => Array.from({ length: n }, () => ms)

describe('automatic quality', () => {
  it('takes the middle frame time, so a few stalls do not count', () => {
    expect(median([16, 17, 300, 16, 18])).toBe(17)
    expect(median([10, 20])).toBe(15)
  })

  it('keeps high quality at 60 frames a second, and drops to low below 40', () => {
    expect(verdict(frames(16.7), { quality: 'high', scale: 1 })).toBeNull()
    expect(verdict(frames(30), { quality: 'high', scale: 1 })).toEqual({ quality: 'low', scale: 1 })
  })

  it('on low, draws a smaller picture below 28 frames a second, down to the smallest scale', () => {
    expect(verdict(frames(30), { quality: 'low', scale: 1 })).toBeNull()
    expect(verdict(frames(45), { quality: 'low', scale: 1 })).toEqual({ quality: 'low', scale: 0.85 })
    expect(verdict(frames(45), { quality: 'low', scale: 0.85 })).toEqual({ quality: 'low', scale: MIN_SCALE })
    expect(verdict(frames(45), { quality: 'low', scale: MIN_SCALE })).toBeNull()
  })

  it('waits for a full sample', () => {
    expect(verdict(frames(50, SAMPLE_FRAMES - 1), { quality: 'high', scale: 1 })).toBeNull()
  })

  it('the sampler leaves out hiccups, judges once, and starts over when reset', () => {
    const s = new FrameSampler()
    const level = { quality: 'high' as const, scale: 1 }
    for (let k = 0; k < 40; k++) expect(s.add(5000, level)).toBeNull()
    let result = null
    for (let k = 0; k < SAMPLE_FRAMES; k++) result = s.add(33, level) ?? result
    expect(result).toEqual({ quality: 'low', scale: 1 })
    expect(s.done).toBe(true)
    expect(s.add(33, level)).toBeNull()
    s.reset()
    expect(s.done).toBe(false)
  })
})
