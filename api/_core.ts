import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// The parts of the account code that need no database or network, kept
// apart so the unit tests can check them directly.

export const GOOGLE_CLIENT_ID = '671666832169-u9r4dca9gj7s48eg6156p04mbq757mc1.apps.googleusercontent.com'

// 3 to 20 letters, digits or underscores. Stored in lower case, so "Ravi"
// and "ravi" are the same player.
export function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().toLowerCase()
  return /^[a-z0-9_]{3,20}$/.test(name) ? name : null
}

export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Enter a password.'
  if (raw.length < 8) return 'Use at least 8 characters.'
  if (raw.length > 200) return 'That password is too long.'
  return null
}

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

// scrypt with a random salt, stored as "scrypt$N$salt$hash" in base64.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const n = 16384
  const key = await derive(password, salt, n)
  return `scrypt$${n}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [kind, n, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !n || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(n))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// What the game saves: cash, cars owned, events won and best results. The
// server only checks the shape and the size, so a broken or huge save
// cannot be stored.
export interface SavedProgress {
  cash: number
  owned: string[]
  [key: string]: unknown
}
export function cleanProgress(raw: unknown): SavedProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  if (typeof p.cash !== 'number' || !Number.isFinite(p.cash) || p.cash < 0) return null
  if (!Array.isArray(p.owned) || !p.owned.every((c) => typeof c === 'string')) return null
  if (JSON.stringify(p).length > 20000) return null
  return p as SavedProgress
}

// Play events, for seeing how the game is played: when someone opens it,
// starts and finishes a race, and a ping for each minute of play. The ids
// are random strings made in the browser; nothing in an event names a
// person.
export const EVENT_NAMES = ['visit', 'race_start', 'race_end', 'minute'] as const
export interface PlayEvent {
  visitor: string
  session: string
  name: (typeof EVENT_NAMES)[number]
  kind: string | null
  value: number | null
  detail: Record<string, string | number | boolean | null> | null
}
const ID = /^[a-z0-9]{8,32}$/
// The only details an event may carry.
const DETAILS = ['place', 'fate', 'career', 'coins', 'touch', 'quality', 'width', 'car', 'laps', 'won', 'weather']
export function cleanEvent(raw: unknown): PlayEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (typeof e.visitor !== 'string' || !ID.test(e.visitor)) return null
  if (typeof e.session !== 'string' || !ID.test(e.session)) return null
  if (!EVENT_NAMES.includes(e.name as PlayEvent['name'])) return null
  const kind = typeof e.kind === 'string' && /^[a-z_-]{1,24}$/.test(e.kind) ? e.kind : null
  const value = typeof e.value === 'number' && Number.isFinite(e.value) && Math.abs(e.value) < 1e6 ? e.value : null
  let detail: PlayEvent['detail'] = null
  if (e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)) {
    detail = {}
    for (const [k, v] of Object.entries(e.detail as Record<string, unknown>).slice(0, 12)) {
      if (!DETAILS.includes(k)) continue
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) detail[k] = v as number | boolean | null
      else if (typeof v === 'string') detail[k] = v.slice(0, 40)
    }
  }
  return { visitor: e.visitor, session: e.session, name: e.name as PlayEvent['name'], kind, value, detail }
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
