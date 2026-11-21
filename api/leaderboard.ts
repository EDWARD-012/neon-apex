import { gunzipSync, gzipSync } from 'node:zlib'
import { checkRun, dailySeed, PHYSICS_VERSION, SEED, weeklySeed } from './_replay.js'
import { currentPlayer, json, sql } from './_lib.js'
import { lapsTable, socialTables } from './_tables.js'

// Leaderboards: the best time-trial lap of each signed-in player on each
// track. GET ?seed= reads a board; GET ?seed=&ghost=<username> gives that
// player's best run, for the game to replay as a ghost; POST sends a
// finished run, which is replayed here through the game's own simulation
// before its lap counts. Times are kept per handling version, so a change
// to the physics starts fresh boards instead of mixing old laps with new
// ones.

const table = lapsTable

const pack = (run: unknown) => gzipSync(JSON.stringify(run)).toString('base64')
const unpack = (text: string) => JSON.parse(gunzipSync(Buffer.from(text, 'base64')).toString('utf8')) as unknown
const USERNAME = /^[a-z0-9_]{3,20}$/
const DAY = 86_400_000

// Ghosts take room, so they are kept only where someone is likely to race
// them: a lap keeps its ghost while it is in its board's top 10, while
// someone who added its driver as a friend has a lap on the same track, or
// while an open challenge points at it. Ghosts on a daily track go once
// the track is more than 7 days old, on a weekly track once it is more
// than 5 weeks old, and on any older physics version straight away. The
// times stay on the boards. Run after every new lap.
async function pruneGhosts(seed: string) {
  await socialTables()
  await sql`update laps set ghost = null
    where seed = ${seed} and physics = ${PHYSICS_VERSION} and ghost is not null
      and player_id not in (select l.player_id from laps l join players p on p.id = l.player_id
        where l.seed = ${seed} and l.physics = ${PHYSICS_VERSION} and p.username is not null
        order by l.time asc, l.set_at asc limit 10)
      and not exists (select 1 from friends f join laps m on m.player_id = f.player_id
        where f.friend_id = laps.player_id and m.seed = laps.seed and m.physics = laps.physics)
      and not exists (select 1 from challenges c
        where c.from_id = laps.player_id and c.seed = laps.seed and c.physics = laps.physics)`
  const now = Date.now()
  await sql`update laps set ghost = null
    where ghost is not null and (physics <> ${PHYSICS_VERSION}
      or (seed ~ '^night-[0-9]{4}-[0-9]{2}-[0-9]{2}$' and seed collate "C" < ${dailySeed(new Date(now - 7 * DAY))})
      or (seed ~ '^week-[0-9]{4}-W[0-9]{2}$' and seed collate "C" < ${weeklySeed(new Date(now - 35 * DAY))}))`
}

// A run of five laps is a few hundred kilobytes of input at most.
const MAX_BODY = 2_000_000

interface Entry {
  name: string
  time: number
  car: string
  ghost: boolean
}

async function board(seed: string, playerId: string | null) {
  const top = (await sql`select p.username as name, l.time, l.car, l.ghost is not null as ghost from laps l join players p on p.id = l.player_id
    where l.seed = ${seed} and l.physics = ${PHYSICS_VERSION} and p.username is not null
    order by l.time asc, l.set_at asc limit 10`) as Entry[]
  const counted = await sql`select count(*)::int as n from laps l join players p on p.id = l.player_id
    where l.seed = ${seed} and l.physics = ${PHYSICS_VERSION} and p.username is not null`
  let me: { place: number; time: number; car: string } | null = null
  if (playerId) {
    const mine = await sql`select time, car from laps where seed = ${seed} and physics = ${PHYSICS_VERSION} and player_id = ${playerId}`
    if (mine[0]) {
      const ahead = await sql`select count(*)::int as n from laps l join players p on p.id = l.player_id
        where l.seed = ${seed} and l.physics = ${PHYSICS_VERSION} and p.username is not null and l.time < ${mine[0].time}`
      me = { place: Number(ahead[0].n) + 1, time: Number(mine[0].time), car: String(mine[0].car) }
    }
  }
  return { seed, physics: PHYSICS_VERSION, count: Number(counted[0].n), top: top.map((e) => ({ name: e.name, time: Number(e.time), car: e.car, ghost: Boolean(e.ghost) })), me }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const seed = params.get('seed') ?? ''
  if (!SEED.test(seed)) return json({ error: 'There is no board for that track.' }, 400)
  await table()
  const name = params.get('ghost')
  if (name !== null) {
    if (!USERNAME.test(name)) return json({ error: 'There is no ghost for that driver.' }, 404)
    const rows = await sql`select l.ghost, l.time, l.car from laps l join players p on p.id = l.player_id
      where l.seed = ${seed} and l.physics = ${PHYSICS_VERSION} and p.username = ${name} and l.ghost is not null`
    if (!rows[0]) return json({ error: 'There is no ghost for that driver.' }, 404)
    return json({ name, time: Number(rows[0].time), car: String(rows[0].car), run: unpack(String(rows[0].ghost)) })
  }
  const player = await currentPlayer(request)
  return json(await board(seed, player?.id ?? null))
}

export async function POST(request: Request) {
  const player = await currentPlayer(request)
  if (!player) return json({ error: 'Sign in to put your laps on the board.' }, 401)
  if (!player.username) return json({ error: 'Choose a username on the Account screen to put your laps on the board.' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'That run is too long to check.' }, 413)
  let raw: unknown = null
  try {
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  const checked = checkRun(raw && typeof raw === 'object' ? (raw as { run?: unknown }).run : null)
  if (!checked.ok) return json({ error: checked.error }, 422)
  const { run, time } = checked
  await table()
  // Keeps the player's best: a slower lap leaves the board as it was.
  await sql`insert into laps (seed, physics, player_id, time, car, fitted, ghost)
    values (${run.seed}, ${PHYSICS_VERSION}, ${player.id}, ${time}, ${run.car}, ${JSON.stringify(run.fitted)}::jsonb, ${pack(run)})
    on conflict (seed, physics, player_id) do update
      set time = excluded.time, car = excluded.car, fitted = excluded.fitted, ghost = excluded.ghost, set_at = now()
      where excluded.time < laps.time`
  await pruneGhosts(run.seed)
  return json({ ok: true, time, board: await board(run.seed, player.id) })
}
