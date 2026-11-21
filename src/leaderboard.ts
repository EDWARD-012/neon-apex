import { cloudEnabled } from './cloud'
import type { Run } from './replay-check'
import { carById } from './sim/cars'

// The time-trial boards: the best checked lap of each signed-in player on
// a track. Off wherever accounts are off (the browser tests and the portal
// build), since both need the game's own server.

export const boardsEnabled = cloudEnabled

export interface Board {
  seed: string
  count: number
  // ghost: the entry's run is kept, so it can be raced as a ghost.
  top: { name: string; time: number; car: string; ghost: boolean }[]
  me: { place: number; time: number; car: string } | null
}

export type Sent = { ok: true; time: number; board: Board } | { ok: false; error: string }

export async function fetchBoard(seed: string): Promise<Board | null> {
  if (!boardsEnabled) return null
  try {
    const response = await fetch(`/api/leaderboard?seed=${encodeURIComponent(seed)}`, { credentials: 'same-origin' })
    return response.ok ? ((await response.json()) as Board) : null
  } catch {
    return null
  }
}

// A board entry's best run, to replay as a ghost (see ghostOf).
export async function fetchGhost(seed: string, name: string): Promise<{ name: string; time: number; car: string; run: Run } | null> {
  if (!boardsEnabled) return null
  try {
    const response = await fetch(`/api/leaderboard?seed=${encodeURIComponent(seed)}&ghost=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
    return response.ok ? ((await response.json()) as { name: string; time: number; car: string; run: Run }) : null
  } catch {
    return null
  }
}

// Sends a finished time trial for the server to replay and time.
export async function sendRun(run: Run): Promise<Sent> {
  try {
    const response = await fetch('/api/leaderboard', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run }),
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (response.ok && body.board) return { ok: true, time: Number(body.time), board: body.board as Board }
    return { ok: false, error: String(body.error ?? 'The board could not be reached. Try again later.') }
  } catch {
    return { ok: false, error: 'The board could not be reached. Check your connection.' }
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Draws a board into el: the top ten, then the player's own place if it is
// further down. `you` marks the player's own row; `note` goes underneath.
// With onRace, each entry that has a ghost gets a button to race it.
export function drawBoard(el: HTMLElement, board: Board | null, format: (seconds: number) => string, you: string | null, note = '', onRace?: (name: string, button: HTMLButtonElement) => void) {
  if (!board) {
    el.innerHTML = `<p class="board-note">${escape(note || 'The board could not be loaded.')}</p>`
    return
  }
  const race = (name: string, ghost: boolean) =>
    onRace && ghost ? `<button class="board-race" data-ghost="${escape(name)}" aria-label="Race ${escape(name)}'s ghost">Race</button>` : onRace ? '<span></span>' : ''
  const row = (place: number, name: string, time: number, car: string, mine: boolean, ghost: boolean) =>
    `<li class="${mine ? 'mine' : ''}${onRace ? ' with-race' : ''}"><span class="board-place">${place}</span><span class="board-name">${escape(name)}</span><span class="board-car">${escape(carById(car).name)}</span><span class="board-time">${format(time)}</span>${race(name, ghost)}</li>`
  const rows = board.top.map((e, k) => row(k + 1, e.name, e.time, e.car, e.name === you, e.ghost))
  if (board.me && board.me.place > board.top.length && you) rows.push(`<li class="board-gap" aria-hidden="true">…</li>`, row(board.me.place, you, board.me.time, board.me.car, true, false))
  const empty = board.top.length === 0 ? '<p class="board-note">No laps on this board yet. Set the first one.</p>' : ''
  const count = board.count > 0 ? `<p class="board-count">${board.count.toLocaleString('en')} ${board.count === 1 ? 'driver' : 'drivers'}</p>` : ''
  el.innerHTML = `${empty}<ol class="board-list">${rows.join('')}</ol>${count}${note ? `<p class="board-note">${escape(note)}</p>` : ''}`
  if (onRace) el.querySelectorAll<HTMLButtonElement>('.board-race').forEach((b) => b.addEventListener('click', () => onRace(b.dataset.ghost as string, b)))
}
