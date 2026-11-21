import { Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { fitLook, fresh, type Progress, setLiveryDetail } from '../src/career'
import { fullLooks, STOCK_LOOKS, styleCar } from '../src/looks'
import type { CarModel } from '../src/render/carModel'

describe('looks', () => {
  it('a look is bought once, then free on every car the player owns', () => {
    const rich: Progress = { ...fresh(), cash: 5000, owned: ['vanta', 'kite'] }
    const first = fitLook(rich, 'vanta', 'finish', 'matte')!
    expect(first.cash).toBe(3500)
    expect(first.ownedLooks).toContain('finish:matte')
    expect(first.looks.vanta.finish).toBe('matte')
    const second = fitLook(first, 'kite', 'finish', 'matte')!
    expect(second.cash).toBe(3500)
    expect(second.looks.kite.finish).toBe('matte')
    // Free looks cost nothing, and a car not owned cannot be styled.
    expect(fitLook(rich, 'vanta', 'glow', 'off')!.cash).toBe(5000)
    expect(fitLook(rich, 'brute', 'finish', 'matte')).toBeNull()
    expect(fitLook({ ...rich, cash: 100 }, 'vanta', 'finish', 'chrome')).toBeNull()
  })

  it('the finish changes the paint and only the paint, and the glow follows its colour', () => {
    const paint = new MeshPhysicalMaterial({ metalness: 0.45, roughness: 0.32, clearcoat: 1 })
    paint.userData.paint = true
    const trim = new MeshPhysicalMaterial({ metalness: 0.25, roughness: 0.42 })
    const glow = new Mesh(new PlaneGeometry(), new MeshBasicMaterial())
    const group = new Group()
    group.add(new Mesh(new PlaneGeometry(), paint), new Mesh(new PlaneGeometry(), trim), glow)
    const model = { group, glow } as unknown as CarModel
    styleCar(model, { ...STOCK_LOOKS, finish: 'matte', glow: 'cyan' }, '#c8102e')
    expect(paint.roughness).toBeGreaterThan(0.7)
    expect(paint.clearcoat).toBe(0)
    expect(trim.roughness).toBe(0.42)
    expect(glow.visible).toBe(true)
    expect((glow.material as MeshBasicMaterial).color.getHexString()).not.toBe('000000')
    // Back to gloss restores the paint as it was made.
    styleCar(model, { ...STOCK_LOOKS, finish: 'gloss', glow: 'off' }, '#c8102e')
    expect(paint.roughness).toBeCloseTo(0.32, 5)
    expect(paint.clearcoat).toBe(1)
    expect(glow.visible).toBe(false)
  })

  it('a livery is bought once, and its colour and number are free to change', () => {
    const rich: Progress = { ...fresh(), cash: 4000, owned: ['vanta', 'kite'] }
    const striped = fitLook(rich, 'vanta', 'livery', 'twin')!
    expect(striped.cash).toBe(2000)
    expect(striped.ownedLooks).toContain('livery:twin')
    expect(striped.looks.vanta.livery).toBe('twin')
    // On another car it costs nothing more.
    expect(fitLook(striped, 'kite', 'livery', 'twin')!.cash).toBe(2000)
    const red = setLiveryDetail(striped, 'vanta', { trim: 'red', number: 44 })!
    expect(red.looks.vanta).toMatchObject({ livery: 'twin', trim: 'red', number: 44 })
    expect(red.cash).toBe(2000)
    // Numbers stay between 1 and 99, and a car not owned can't be styled.
    expect(setLiveryDetail(striped, 'vanta', { number: 140 })).toBeNull()
    expect(setLiveryDetail(striped, 'brute', { trim: 'red' })).toBeNull()
  })

  it('an older save without liveries gets the stock ones, and bad values are dropped', () => {
    expect(fullLooks({ finish: 'matte', glow: 'cyan' } as never)).toEqual({ ...STOCK_LOOKS, finish: 'matte', glow: 'cyan' })
    expect(fullLooks({ finish: 'gold', livery: 'flames', trim: 'mauve', number: 0 } as never)).toEqual(STOCK_LOOKS)
    expect(fullLooks(undefined)).toEqual(STOCK_LOOKS)
  })

  it('wheels, ride height, tint and spoilers are bought like the other looks', () => {
    const rich: Progress = { ...fresh(), cash: 10000, owned: ['vanta'] }
    let p = fitLook(rich, 'vanta', 'rims', 'deep')!
    p = fitLook(p, 'vanta', 'ride', 'slammed')!
    p = fitLook(p, 'vanta', 'tint', 'limo')!
    p = fitLook(p, 'vanta', 'spoiler', 'wing')!
    expect(p.cash).toBe(10000 - 3000 - 2000 - 1500 - 3500)
    expect(p.looks.vanta).toMatchObject({ rims: 'deep', ride: 'slammed', tint: 'limo', spoiler: 'wing' })
    // Back to stock costs nothing, and the parts stay owned.
    p = fitLook(p, 'vanta', 'rims', 'stock')!
    expect(p.cash).toBe(0)
    expect(p.ownedLooks).toContain('rims:deep')
    // Parts that don't exist are refused.
    expect(fitLook(p, 'vanta', 'spoiler', 'rocket')).toBeNull()
  })
})
