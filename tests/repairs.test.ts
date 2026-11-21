import { describe, expect, it } from 'vitest'
import { addWear, carried, fresh, MAX_CARRY, repair, REPAIR_FULL, repairPrice, tidy, wearOf } from '../src/career'

describe('repairs', () => {
  it('damage taken in a career event adds to what the car had', () => {
    let p = fresh()
    p = addWear(p, 'vanta', 0, 0.3)
    expect(wearOf(p, 'vanta')).toBe(0.3)
    // The next event starts at 0.3, and the car ends it at 0.45.
    p = addWear(p, 'vanta', carried(p, 'vanta'), 0.45)
    expect(wearOf(p, 'vanta')).toBe(0.45)
    expect(wearOf(p, 'kite')).toBe(0)
  })

  it('a clean event leaves the save alone', () => {
    const p = addWear(fresh(), 'vanta', 0, 0.001)
    expect(p.wear).toEqual({})
  })

  it('a car starts an event with at most half damage, but keeps the rest until repaired', () => {
    let p = addWear(fresh(), 'vanta', 0, 1)
    expect(wearOf(p, 'vanta')).toBe(1)
    expect(carried(p, 'vanta')).toBe(MAX_CARRY)
    // Patched to half, then driven clean: still wrecked underneath.
    p = addWear(p, 'vanta', carried(p, 'vanta'), MAX_CARRY)
    expect(wearOf(p, 'vanta')).toBe(1)
  })

  it('a repair costs its share of a full repair and clears the damage', () => {
    const p = { ...addWear(fresh(), 'vanta', 0, 0.34), cash: 1000 }
    expect(repairPrice(p, 'vanta')).toBe(Math.round((0.34 * REPAIR_FULL) / 50) * 50)
    const fixed = repair(p, 'vanta')
    expect(fixed?.cash).toBe(1000 - repairPrice(p, 'vanta'))
    expect(fixed && wearOf(fixed, 'vanta')).toBe(0)
  })

  it('no repair without the coins, or without damage', () => {
    const worn = addWear(fresh(), 'vanta', 0, 1)
    expect(repairPrice(worn, 'vanta')).toBe(REPAIR_FULL)
    expect(repair({ ...worn, cash: REPAIR_FULL - 1 }, 'vanta')).toBeNull()
    expect(repair({ ...fresh(), cash: 5000 }, 'vanta')).toBeNull()
  })

  it('even a scratch costs something', () => {
    expect(repairPrice(addWear(fresh(), 'vanta', 0, 0.01), 'vanta')).toBe(50)
  })

  it('an old save gets no damage, and a broken one is cleaned up', () => {
    expect(tidy({ cash: 5, owned: ['vanta'] }).wear).toEqual({})
    expect(tidy({ cash: 5, owned: ['vanta'], wear: { vanta: 3, kite: -1, volt: 'x' as unknown as number, brute: 0.2 } }).wear).toEqual({ vanta: 1, brute: 0.2 })
  })
})
