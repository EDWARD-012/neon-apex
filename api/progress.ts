import { cleanProgress } from './_core.js'
import { body, currentPlayer, json, sql } from './_lib.js'

// Saves the signed-in player's progress.
export async function PUT(request: Request) {
  const player = await currentPlayer(request)
  if (!player) return json({ error: 'Not signed in.' }, 401)
  const progress = cleanProgress((await body(request)).progress)
  if (!progress) return json({ error: 'That save does not look right.' }, 400)
  await sql`update players set progress = ${JSON.stringify(progress)}::jsonb, updated_at = now() where id = ${player.id}`
  return json({ ok: true })
}
