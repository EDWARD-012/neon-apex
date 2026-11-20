import { currentPlayer, json, view } from './_lib.js'

// Who is signed in, and their saved progress.
export async function GET(request: Request) {
  const player = await currentPlayer(request)
  if (!player) return json({ signedIn: false })
  return json({ signedIn: true, ...view(player) })
}
