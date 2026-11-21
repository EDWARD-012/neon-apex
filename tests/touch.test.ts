import { describe, expect, it } from 'vitest'
import { PEDAL_LOW, pedalAmount } from '../src/touch'

describe('the phone pedals', () => {
  it('give part throttle at the bottom of the pedal and full at the top', () => {
    expect(pedalAmount(200, 100, 100)).toBeCloseTo(PEDAL_LOW, 5)
    expect(pedalAmount(100, 100, 100)).toBeCloseTo(1, 5)
    expect(pedalAmount(150, 100, 100)).toBeCloseTo((PEDAL_LOW + 1) / 2, 5)
    // A finger that slides off the end stays at the end.
    expect(pedalAmount(60, 100, 100)).toBe(1)
    expect(pedalAmount(260, 100, 100)).toBe(PEDAL_LOW)
  })
})
