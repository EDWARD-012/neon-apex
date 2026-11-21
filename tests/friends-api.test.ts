import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PHYSICS_VERSION } from '../src/replay-check'

// The friends endpoint with the database and the session faked: who may
// use it, adding friends, the rules for challenges, and what it returns.

const db = vi.hoisted(() => ({
  queries: [] as { text: string; values: unknown[] }[],
  player: null as { id: string; username: string | null; progress: unknown } | null,
  players: {} as Record<string, string>,
  friendCount: 0,
  isFriend: false,
  myLap: null as number | null,
  sentToday: 0,
}))

vi.mock('../api/_lib.js', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    db.queries.push({ text, values })
    const rows = (r: unknown[]) => Promise.resolve(r)
    if (text.startsWith('select id from players')) return rows(db.players[String(values[0])] ? [{ id: db.players[String(values[0])] }] : [])
    if (text.startsWith('select count(*)::int as n from friends')) return rows([{ n: db.friendCount }])
    if (text.startsWith('select 1 from friends')) return rows(db.isFriend ? [{ '?column?': 1 }] : [])
    if (text.startsWith('select time from laps')) return rows(db.myLap === null ? [] : [{ time: db.myLap }])
    if (text.startsWith('select count(*)::int as n from challenges')) return rows([{ n: db.sentToday }])
    if (text.startsWith('select p.username as name from friends')) return rows([{ name: 'selin' }])
    if (text.startsWith('select c.id')) return rows([{ id: 4, name: 'kade', seed: 'night-2026-11-21', time: 45.5, sent_at: 'x', mine: null, ghost: true }])
    if (text.startsWith('select p.username as name, t.seed')) return rows([{ name: 'selin', seed: 'week-2026-W47', time: 50.1, mine: 51.2, set_at: 'y', ghost: false }])
    return rows([])
  },
  table: () => Promise.resolve(),
  body: async (request: Request) => {
    try {
      return (await request.json()) as Record<string, unknown>
    } catch {
      return {}
    }
  },
  currentPlayer: () => Promise.resolve(db.player),
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}))

const { GET, POST } = await import('../api/friends')

const post = (body: unknown) => POST(new Request('https://skidline.test/api/friends', { method: 'POST', body: JSON.stringify(body) }))
const ran = (start: string) => db.queries.filter((q) => q.text.startsWith(start))

describe('the friends endpoint', () => {
  beforeEach(() => {
    db.queries = []
    db.player = { id: '7', username: 'ravi', progress: null }
    db.players = { ravi: '7', selin: '9', kade: '11' }
    db.friendCount = 0
    db.isFriend = false
    db.myLap = null
    db.sentToday = 0
  })

  it('is for signed-in players with a username', async () => {
    db.player = null
    expect((await GET(new Request('https://skidline.test/api/friends'))).status).toBe(401)
    db.player = { id: '7', username: null, progress: null }
    expect((await GET(new Request('https://skidline.test/api/friends'))).status).toBe(403)
  })

  it('returns friends, challenges and the rivals feed', async () => {
    const response = await GET(new Request('https://skidline.test/api/friends'))
    expect(await response.json()).toEqual({
      friends: ['selin'],
      challenges: [{ id: '4', name: 'kade', seed: 'night-2026-11-21', time: 45.5, mine: null, ghost: true, at: 'x' }],
      feed: [{ name: 'selin', seed: 'week-2026-W47', time: 50.1, mine: 51.2, ghost: false, at: 'y' }],
    })
  })

  it('adds a friend by username, in any case, but not yourself or a stranger', async () => {
    expect((await post({ action: 'add', name: ' Selin ' })).status).toBe(200)
    expect(ran('insert into friends')[0].values).toEqual(['7', '9'])
    expect((await post({ action: 'add', name: 'ravi' })).status).toBe(400)
    expect((await post({ action: 'add', name: 'nobody' })).status).toBe(404)
    expect((await post({ action: 'add', name: "x'; drop" })).status).toBe(404)
    db.friendCount = 200
    expect((await post({ action: 'add', name: 'kade' })).status).toBe(409)
  })

  it('removes a friend', async () => {
    expect((await post({ action: 'remove', name: 'selin' })).status).toBe(200)
    expect(ran('delete from friends')[0].values).toEqual(['7', '9'])
  })

  it('sends a challenge only to a friend, only with a checked lap, and not too many a day', async () => {
    const send = () => post({ action: 'challenge', to: 'selin', seed: 'night-2026-11-21' })
    expect((await send()).status).toBe(403)
    db.isFriend = true
    expect((await send()).status).toBe(409)
    db.myLap = 46.25
    expect((await send()).status).toBe(200)
    expect(ran('insert into challenges')[0].values).toEqual(['7', '9', 'night-2026-11-21', PHYSICS_VERSION, 46.25])
    db.sentToday = 30
    expect((await send()).status).toBe(429)
    expect((await post({ action: 'challenge', to: 'selin', seed: '../x' })).status).toBe(400)
  })

  it('dismisses only a challenge sent to you', async () => {
    expect((await post({ action: 'dismiss', id: '4' })).status).toBe(200)
    expect(ran('update challenges set dismissed')[0].values).toEqual(['4', '7'])
    expect((await post({ action: 'dismiss', id: 'drop' })).status).toBe(404)
    expect((await post({ action: 'wave' })).status).toBe(400)
  })
})
