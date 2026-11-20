import { describe, expect, it } from 'vitest'
import { checkPassword, cleanProgress, cleanUsername, hashPassword, passwordProblem, readCookie } from '../api/_core'

describe('accounts', () => {
  it('accepts usernames of 3 to 20 letters, numbers or underscores, in lower case', () => {
    expect(cleanUsername('Ravi_7780')).toBe('ravi_7780')
    expect(cleanUsername('  apex  ')).toBe('apex')
    expect(cleanUsername('ab')).toBeNull()
    expect(cleanUsername('a'.repeat(21))).toBeNull()
    expect(cleanUsername('has space')).toBeNull()
    expect(cleanUsername("x'; drop table")).toBeNull()
    expect(cleanUsername(42)).toBeNull()
  })

  it('asks for passwords of at least 8 characters', () => {
    expect(passwordProblem('short')).not.toBeNull()
    expect(passwordProblem('long enough')).toBeNull()
    expect(passwordProblem(undefined)).not.toBeNull()
  })

  it('hashes passwords with a salt and checks them', async () => {
    const a = await hashPassword('correct horse')
    const b = await hashPassword('correct horse')
    expect(a).not.toBe(b)
    expect(a).not.toContain('correct')
    expect(await checkPassword('correct horse', a)).toBe(true)
    expect(await checkPassword('wrong horse', a)).toBe(false)
    expect(await checkPassword('correct horse', null)).toBe(false)
    expect(await checkPassword('correct horse', 'plain-text')).toBe(false)
  })

  it('stores only saves with the right shape and a sane size', () => {
    expect(cleanProgress({ cash: 500, owned: ['vanta'], won: {} })).not.toBeNull()
    expect(cleanProgress({ cash: -1, owned: [] })).toBeNull()
    expect(cleanProgress({ cash: 5, owned: [1] })).toBeNull()
    expect(cleanProgress([])).toBeNull()
    expect(cleanProgress({ cash: 5, owned: [], junk: 'x'.repeat(30000) })).toBeNull()
  })

  it('reads one cookie out of the header', () => {
    expect(readCookie('a=1; na_session=abc.def; b=2', 'na_session')).toBe('abc.def')
    expect(readCookie(null, 'na_session')).toBeNull()
  })
})
