import { body, json, sessionCookie, sql, table, verifyGoogle, view, type Player } from '../_lib.js'

// Sign in with Google. Creates the player the first time; they then pick a
// username and password at /api/auth/setup.
export async function POST(request: Request) {
  const { credential } = await body(request)
  if (typeof credential !== 'string') return json({ error: 'Missing Google credential.' }, 400)
  let google
  try {
    google = await verifyGoogle(credential)
  } catch {
    return json({ error: 'Google sign-in could not be checked. Try again.' }, 401)
  }
  await table()
  const rows = await sql`insert into players (google_sub, email) values (${google.sub}, ${google.email})
    on conflict (google_sub) do update set email = excluded.email
    returning id, username, progress`
  const player = rows[0] as Player
  return json(view(player), 200, await sessionCookie(player.id))
}
