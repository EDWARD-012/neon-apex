import { describe, expect, it } from 'vitest'
import { cleanEvent } from '../api/_core'

describe('play events', () => {
  const good = { visitor: 'abc123def456', session: 'zz9988yy7766', name: 'race_end', kind: 'race', value: 182.5, detail: { place: 2, fate: null, career: true } }

  it('keeps a well-formed event', () => {
    expect(cleanEvent(good)).toEqual(good)
  })

  it('refuses an event with a bad id or an unknown name', () => {
    expect(cleanEvent({ ...good, visitor: 'Robert; drop' })).toBeNull()
    expect(cleanEvent({ ...good, session: 'x' })).toBeNull()
    expect(cleanEvent({ ...good, name: 'purchase' })).toBeNull()
    expect(cleanEvent('race_end')).toBeNull()
    expect(cleanEvent(null)).toBeNull()
  })

  it('keeps only the known details, and trims long strings', () => {
    const e = cleanEvent({ ...good, kind: 'DROP TABLE', value: Infinity, detail: { place: 1, car: 'k'.repeat(100), email: 'someone@example.com', fate: { a: 1 } } })
    expect(e?.kind).toBeNull()
    expect(e?.value).toBeNull()
    expect(e?.detail).toEqual({ place: 1, car: 'k'.repeat(40) })
  })
})
