import { PHYSICS_VERSION, SEED } from './_replay.js'
import { body, currentPlayer, json, type Player, sql } from './_lib.js'
import { socialTables } from './_tables.js'

// Friends and challenges, for signed-in players with a username.
//   GET   your friends (and which of them added you back), who added you
//         without being added back, the challenges sent to you, and the
//         rivals feed: friends whose lap beat yours on a board in the last
//         14 days.
//   POST  { action: 'add' | 'remove', name }
//         { action: 'challenge', to, seed }: your best lap on that track,
//         sent to a friend who has added you back
//         { action: 'dismiss', id }: deletes a challenge sent to you
// Adding someone is one-way and needs no yes, since the feed only reads the
// public boards. A challenge lands on someone else's screen, so it needs
// both of you to have added each other. Challenges are deleted when
// dismissed, or after 30 days.

const USERNAME = /^[a-z0-9_]{3,20}$/
const MAX_FRIENDS = 200
const CHALLENGES_A_DAY = 30

async function signedIn(request: Request): Promise<Player | Response> {
  const player = await currentPlayer(request)
  if (!player) return json({ error: 'Sign in to have friends.' }, 401)
  if (!player.username) return json({ error: 'Choose a username on the Account screen first.' }, 403)
  await socialTables()
  await sql`delete from challenges where sent_at < now() - interval '30 days'`
  return player
}

async function view(me: string) {
  const friends = await sql`select p.username as name,
      exists (select 1 from friends g where g.player_id = f.friend_id and g.friend_id = f.player_id) as mutual
    from friends f join players p on p.id = f.friend_id
    where f.player_id = ${me} and p.username is not null order by p.username`
  const addedYou = await sql`select p.username as name from friends f join players p on p.id = f.player_id
    where f.friend_id = ${me} and p.username is not null
      and not exists (select 1 from friends g where g.player_id = ${me} and g.friend_id = f.player_id)
    order by f.added_at desc limit 50`
  const challenges = await sql`select c.id, p.username as name, c.seed, c.time, c.sent_at,
      m.time as mine, l.ghost is not null as ghost
    from challenges c
    join players p on p.id = c.from_id
    left join laps m on m.player_id = c.to_id and m.seed = c.seed and m.physics = c.physics
    left join laps l on l.player_id = c.from_id and l.seed = c.seed and l.physics = c.physics
    where c.to_id = ${me} and c.physics = ${PHYSICS_VERSION} and p.username is not null
    order by c.sent_at desc limit 20`
  // The feed looks back 14 days.
  const feed = await sql`select p.username as name, t.seed, t.time, m.time as mine, t.set_at, t.ghost is not null as ghost
    from friends f
    join laps t on t.player_id = f.friend_id and t.physics = ${PHYSICS_VERSION}
    join laps m on m.player_id = f.player_id and m.seed = t.seed and m.physics = t.physics
    join players p on p.id = f.friend_id
    where f.player_id = ${me} and t.time < m.time and t.set_at > now() - interval '14 days' and p.username is not null
    order by t.set_at desc limit 10`
  return {
    friends: friends.map((f) => String(f.name)),
    mutual: friends.filter((f) => f.mutual).map((f) => String(f.name)),
    addedYou: addedYou.map((f) => String(f.name)),
    challenges: challenges.map((c) => ({ id: String(c.id), name: String(c.name), seed: String(c.seed), time: Number(c.time), mine: c.mine === null ? null : Number(c.mine), ghost: Boolean(c.ghost), at: String(c.sent_at) })),
    feed: feed.map((f) => ({ name: String(f.name), seed: String(f.seed), time: Number(f.time), mine: Number(f.mine), ghost: Boolean(f.ghost), at: String(f.set_at) })),
  }
}

export async function GET(request: Request) {
  const me = await signedIn(request)
  if (me instanceof Response) return me
  return json(await view(me.id))
}

export async function POST(request: Request) {
  const me = await signedIn(request)
  if (me instanceof Response) return me
  const input = await body(request)
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : typeof input.to === 'string' ? input.to.trim().toLowerCase() : ''

  if (input.action === 'add' || input.action === 'remove' || input.action === 'challenge') {
    if (!USERNAME.test(name)) return json({ error: 'There is no driver called that.' }, 404)
    const rows = await sql`select id from players where username = ${name}`
    if (!rows[0]) return json({ error: `There is no driver called ${name}.` }, 404)
    const them = String(rows[0].id)
    if (them === me.id) return json({ error: 'That is you.' }, 400)

    if (input.action === 'add') {
      const counted = await sql`select count(*)::int as n from friends where player_id = ${me.id}`
      if (Number(counted[0].n) >= MAX_FRIENDS) return json({ error: `You can have up to ${MAX_FRIENDS} friends.` }, 409)
      await sql`insert into friends (player_id, friend_id) values (${me.id}, ${them}) on conflict do nothing`
    } else if (input.action === 'remove') {
      await sql`delete from friends where player_id = ${me.id} and friend_id = ${them}`
    } else {
      const seed = typeof input.seed === 'string' ? input.seed : ''
      if (!SEED.test(seed)) return json({ error: 'There is no board for that track.' }, 400)
      const both = await sql`select 1 from friends a join friends b on b.player_id = a.friend_id and b.friend_id = a.player_id
        where a.player_id = ${me.id} and a.friend_id = ${them}`
      if (!both[0]) return json({ error: `You can challenge ${name} once you have both added each other.` }, 403)
      const lap = await sql`select time from laps where player_id = ${me.id} and seed = ${seed} and physics = ${PHYSICS_VERSION}`
      if (!lap[0]) return json({ error: 'Set a checked lap on this track first.' }, 409)
      const sent = await sql`select count(*)::int as n from challenges where from_id = ${me.id} and sent_at > now() - interval '1 day'`
      if (Number(sent[0].n) >= CHALLENGES_A_DAY) return json({ error: `You can send up to ${CHALLENGES_A_DAY} challenges a day.` }, 429)
      // One challenge per sender, driver and track: sending again updates
      // its time.
      await sql`insert into challenges (from_id, to_id, seed, physics, time) values (${me.id}, ${them}, ${seed}, ${PHYSICS_VERSION}, ${Number(lap[0].time)})
        on conflict (from_id, to_id, seed, physics) do update set time = excluded.time, sent_at = now()`
    }
  } else if (input.action === 'dismiss') {
    const id = typeof input.id === 'string' && /^\d{1,18}$/.test(input.id) ? input.id : null
    if (!id) return json({ error: 'No such challenge.' }, 404)
    await sql`delete from challenges where id = ${id} and to_id = ${me.id}`
  } else {
    return json({ error: 'Unknown action.' }, 400)
  }
  return json(await view(me.id))
}
