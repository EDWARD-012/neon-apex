import { cleanUsername, hashPassword, passwordProblem } from '../_core.js'
import { body, currentPlayer, json, sql, view, type Player } from '../_lib.js'

// After the first Google sign-in: choose the username and password used to
// sign in on other devices. Only allowed once per player.
export async function POST(request: Request) {
  const player = await currentPlayer(request)
  if (!player) return json({ error: 'Sign in with Google first.' }, 401)
  if (player.username) return json({ error: 'This account already has a username.' }, 409)
  const input = await body(request)
  const username = cleanUsername(input.username)
  if (!username) return json({ error: 'Usernames are 3 to 20 letters, numbers or underscores.' }, 400)
  const problem = passwordProblem(input.password)
  if (problem) return json({ error: problem }, 400)
  const hash = await hashPassword(input.password as string)
  try {
    const rows = await sql`update players set username = ${username}, password_hash = ${hash}, updated_at = now()
      where id = ${player.id} and username is null returning id, username, progress`
    if (!rows[0]) return json({ error: 'This account already has a username.' }, 409)
    return json(view(rows[0] as Player))
  } catch {
    return json({ error: 'That username is taken.' }, 409)
  }
}
