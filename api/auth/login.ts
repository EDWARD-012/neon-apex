import { checkPassword, cleanUsername } from '../_core.js'
import { body, json, sessionCookie, sql, table, view, type Player } from '../_lib.js'

// Sign in with the username and password chosen after the first Google
// sign-in.
export async function POST(request: Request) {
  const input = await body(request)
  const username = cleanUsername(input.username)
  const password = typeof input.password === 'string' ? input.password : ''
  await table()
  const rows = username ? await sql`select id, username, progress, password_hash from players where username = ${username}` : []
  const row = rows[0] as (Player & { password_hash: string | null }) | undefined
  // Same answer and roughly the same time whether the name exists or not.
  const ok = await checkPassword(password, row?.password_hash ?? 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
  if (!row || !ok) return json({ error: 'Wrong username or password.' }, 401)
  return json(view(row), 200, await sessionCookie(row.id))
}
