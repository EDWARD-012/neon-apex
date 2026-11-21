import { gunzipSync, gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_STEPS, type Run, RunRecorder, StartWatch } from '../src/replay-check'
import { createDriver, drive } from '../src/sim/ai'
import { carById } from '../src/sim/cars'
import { Race, STEP } from '../src/sim/race'

// The leaderboard endpoint with the database and the session faked: what
// it accepts, what it refuses, and the time it stores.

const db = vi.hoisted(() => ({
  queries: [] as { text: string; values: unknown[] }[],
  player: null as { id: string; username: string | null; progress: unknown } | null,
  ghostRow: null as Record<string, unknown> | null,
}))

vi.mock('../api/_lib.js', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    db.queries.push({ text, values })
    if (text.startsWith('select count(*)')) return Promise.resolve([{ n: 0 }])
    if (text.startsWith('select l.ghost')) return Promise.resolve(db.ghostRow ? [db.ghostRow] : [])
    return Promise.resolve([])
  },
  table: () => Promise.resolve(),
  currentPlayer: () => Promise.resolve(db.player),
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}))

const { GET, POST } = await import('../api/leaderboard')

function trial(): Run {
  const race = new Race({ seed: 'api-test', laps: 1, rivals: 0, traffic: 0, mode: 'circuit', playerSpec: carById('kite').spec })
  const recorder = new RunRecorder('api-test', 1)
  const start = new StartWatch()
  const driver = createDriver(1)
  for (let n = 0; race.player.finishTime === null && n < MAX_STEPS; n++) {
    race.playerInput = drive(race.player.car, driver, race.track, race.line, [], STEP)
    race.playerInput = recorder.step(race)
    const before = race.phase
    race.step()
    start.after(race, before)
    race.events = []
  }
  return recorder.finish(race, 'kite') as Run
}

const post = (body: unknown) => POST(new Request('https://skidline.test/api/leaderboard', { method: 'POST', body: JSON.stringify(body) }))

describe('the leaderboard endpoint', () => {
  const run = trial()

  beforeEach(() => {
    db.queries = []
    db.player = { id: '7', username: 'ravi', progress: null }
    db.ghostRow = null
  })

  it('replays a run, stores the replay’s own time, and returns the board', async () => {
    const response = await post({ run })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.time).toBe(run.best)
    const insert = db.queries.find((q) => q.text.startsWith('insert into laps'))
    expect(insert?.values.slice(0, 6)).toEqual(['api-test', run.physics, '7', run.best, 'kite', '{}'])
    // The run itself is kept, gzipped, for ghosts, and ghosts outside the
    // top 10 and on old daily and weekly tracks are cleared.
    expect(JSON.parse(gunzipSync(Buffer.from(String(insert?.values[6]), 'base64')).toString('utf8'))).toEqual(run)
    const prunes = db.queries.filter((q) => q.text.startsWith('update laps set ghost = null'))
    expect(prunes).toHaveLength(2)
    expect(prunes[0].text).toContain('limit 10')
    expect(prunes[0].values[0]).toBe('api-test')
    expect(prunes[1].values[1]).toMatch(/^night-\d{4}-\d{2}-\d{2}$/)
    expect(prunes[1].values[2]).toMatch(/^week-\d{4}-W\d{2}$/)
    expect(body.board.seed).toBe('api-test')
  })

  it('wants a signed-in player with a username', async () => {
    db.player = null
    expect((await post({ run })).status).toBe(401)
    db.player = { id: '7', username: null, progress: null }
    expect((await post({ run })).status).toBe(403)
  })

  it('refuses a run whose lap the replay does not match, and stores nothing', async () => {
    const response = await post({ run: { ...run, best: run.best - 3 } })
    expect(response.status).toBe(422)
    expect(db.queries.some((q) => q.text.startsWith('insert'))).toBe(false)
  })

  it('refuses a body that is not a run', async () => {
    expect((await POST(new Request('https://skidline.test/api/leaderboard', { method: 'POST', body: 'not json' }))).status).toBe(422)
  })

  it('reads a board, and refuses an odd track name', async () => {
    const ok = await GET(new Request('https://skidline.test/api/leaderboard?seed=night-2026-11-21'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).top).toEqual([])
    const bad = await GET(new Request('https://skidline.test/api/leaderboard?seed=%27%3B%20drop'))
    expect(bad.status).toBe(400)
  })

  it('hands out a driver’s best run as a ghost', async () => {
    db.ghostRow = { ghost: gzipSync(JSON.stringify(run)).toString('base64'), time: run.best, car: 'kite' }
    const response = await GET(new Request('https://skidline.test/api/leaderboard?seed=api-test&ghost=ravi'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: 'ravi', time: run.best, car: 'kite', run })
    db.ghostRow = null
    expect((await GET(new Request('https://skidline.test/api/leaderboard?seed=api-test&ghost=nobody'))).status).toBe(404)
    expect((await GET(new Request('https://skidline.test/api/leaderboard?seed=api-test&ghost=%27or%201'))).status).toBe(404)
  })
})
