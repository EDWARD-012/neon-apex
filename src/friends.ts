import { cloudEnabled } from './cloud'
import { dailySeed, weeklySeed } from './sim/track'

// Friends, challenges and the rivals feed (see api/friends.ts). Like the
// leaderboards, they need the game's own server, so they are off in the
// browser tests and the portal build.

export const friendsEnabled = cloudEnabled

export interface Social {
  friends: string[]
  // Friends who have added you too: the ones you can challenge.
  mutual: string[]
  // Drivers who added you and whom you haven't added back.
  addedYou: string[]
  // Sent to you: a friend's lap on a track, and your own best there.
  challenges: { id: string; name: string; seed: string; time: number; mine: number | null; ghost: boolean }[]
  // Friends whose lap beat yours on a board in the last 14 days.
  feed: { name: string; seed: string; time: number; mine: number; ghost: boolean }[]
}

export type Acted = { ok: true; social: Social } | { ok: false; error: string }

async function call(method: 'GET' | 'POST', data?: unknown): Promise<Acted> {
  try {
    const response = await fetch('/api/friends', {
      method,
      credentials: 'same-origin',
      headers: data === undefined ? undefined : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (response.ok && Array.isArray(body.friends)) return { ok: true, social: body as unknown as Social }
    return { ok: false, error: String(body.error ?? 'Friends could not be reached. Try again later.') }
  } catch {
    return { ok: false, error: 'Friends could not be reached. Check your connection.' }
  }
}

export const fetchSocial = () => (friendsEnabled ? call('GET') : Promise.resolve<Acted>({ ok: false, error: '' }))
export const addFriend = (name: string) => call('POST', { action: 'add', name })
export const removeFriend = (name: string) => call('POST', { action: 'remove', name })
export const challenge = (to: string, seed: string) => call('POST', { action: 'challenge', to, seed })
export const dismiss = (id: string) => call('POST', { action: 'dismiss', id })

// A short name for a track seed, for the feed and the challenges.
export function trackName(seed: string): string {
  if (seed === dailySeed()) return "today's track"
  if (seed === weeklySeed()) return "this week's track"
  const day = /^night-(\d{4})-(\d{2})-(\d{2})$/.exec(seed)
  if (day) return `the track of ${Number(day[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(day[2]) - 1]}`
  const week = /^week-(\d{4})-W(\d{2})$/.exec(seed)
  if (week) return `the track of week ${Number(week[2])}`
  if (seed.startsWith('random-')) return `track #${seed.slice(7)}`
  return `track "${seed}"`
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

type Format = (seconds: number) => string
type Race = (seed: string, name: string, ghost: boolean, button: HTMLButtonElement) => void

function wire(el: HTMLElement, race: Race, extra?: (b: HTMLButtonElement) => void) {
  el.querySelectorAll<HTMLButtonElement>('button[data-race]').forEach((b) =>
    b.addEventListener('click', () => race(b.dataset.seed as string, b.dataset.race as string, b.dataset.ghost === '1', b)),
  )
  if (extra) el.querySelectorAll<HTMLButtonElement>('button[data-id], button[data-remove], button[data-add]').forEach(extra)
}

const raceButton = (seed: string, name: string, ghost: boolean, label: string) =>
  `<button class="board-race" data-race="${escape(name)}" data-seed="${escape(seed)}" data-ghost="${ghost ? 1 : 0}">${label}</button>`

// The rivals feed on the menu: the newest few laps by friends that beat
// yours, each with a button to race them.
export function drawFeed(el: HTMLElement, social: Social | null, format: Format, race: Race, most = 3) {
  const items = social?.feed.slice(0, most) ?? []
  el.classList.toggle('hidden', items.length === 0)
  el.innerHTML = items.length
    ? `<h3>Rivals</h3><ul class="feed-list">${items
        .map((f) => `<li><span><b>${escape(f.name)}</b> beat you on ${escape(trackName(f.seed))}: ${format(f.time)} to your ${format(f.mine)}</span>${raceButton(f.seed, f.name, f.ghost, 'Race')}</li>`)
        .join('')}</ul>`
    : ''
  wire(el, race)
}

// The Friends screen: drivers who added you, challenges sent to you, the
// rivals feed in full, and your friends, each with a button to remove them.
export function drawSocial(el: HTMLElement, social: Social, format: Format, race: Race, onDismiss: (id: string) => void, onRemove: (name: string) => void, onAdd: (name: string) => void) {
  const added = social.addedYou.length
    ? `<h3>Added you</h3><ul class="feed-list">${social.addedYou.map((n) => `<li><span><b>${escape(n)}</b> added you. Add them back to send each other challenges.</span><button class="board-race" data-add="${escape(n)}">Add back</button></li>`).join('')}</ul>`
    : ''
  const challenges = social.challenges.length
    ? social.challenges
        .map((c) => {
          const state = c.mine === null ? 'no lap from you yet' : c.mine < c.time ? `you beat it with ${format(c.mine)}` : `your best is ${format(c.mine)}`
          return `<li><span><b>${escape(c.name)}</b> challenges you on ${escape(trackName(c.seed))}: ${format(c.time)}, ${state}</span>${raceButton(c.seed, c.name, c.ghost, 'Race')}<button class="ghost-button" data-id="${escape(c.id)}">Dismiss</button></li>`
        })
        .join('')
    : '<li class="empty">No challenges. When a friend sends you a lap to beat, it shows here.</li>'
  const feed = social.feed.length
    ? social.feed.map((f) => `<li><span><b>${escape(f.name)}</b> beat you on ${escape(trackName(f.seed))}: ${format(f.time)} to your ${format(f.mine)}</span>${raceButton(f.seed, f.name, f.ghost, 'Race')}</li>`).join('')
    : '<li class="empty">Nobody has beaten your laps lately.</li>'
  const friends = social.friends.length
    ? social.friends
        .map((n) => `<li><span>${escape(n)} <small>${social.mutual.includes(n) ? 'added you too' : 'has not added you back yet'}</small></span><button class="ghost-button" data-remove="${escape(n)}">Remove</button></li>`)
        .join('')
    : '<li class="empty">No friends yet. Add a driver by their username.</li>'
  el.innerHTML = `${added}<h3>Challenges</h3><ul class="feed-list">${challenges}</ul><h3>Rivals</h3><ul class="feed-list">${feed}</ul><h3>Your friends</h3><ul class="feed-list">${friends}</ul>`
  wire(el, race, (b) =>
    b.addEventListener('click', () => {
      b.disabled = true
      if (b.dataset.id) onDismiss(b.dataset.id)
      else if (b.dataset.add) onAdd(b.dataset.add)
      else onRemove(b.dataset.remove as string)
    }),
  )
}

// Under a time trial's board, once your lap is checked: send that track
// and your time to a friend who has added you back.
export function drawChallenge(el: HTMLElement, friends: string[], seed: string) {
  if (friends.length === 0) {
    el.innerHTML = '<p class="board-note">Challenges go to friends who have added you back. Add friends on the Friends screen.</p>'
    return
  }
  el.innerHTML = `<div class="challenge-send"><label>Challenge a friend <select>${friends.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join('')}</select></label><button class="board-race">Send</button></div><p class="board-note" aria-live="polite"></p>`
  const select = el.querySelector('select') as HTMLSelectElement
  const button = el.querySelector('button') as HTMLButtonElement
  const note = el.querySelector('p') as HTMLElement
  button.addEventListener('click', () => {
    button.disabled = true
    void challenge(select.value, seed).then((done) => {
      button.disabled = false
      note.textContent = done.ok ? `Sent to ${select.value}: your best lap on ${trackName(seed)}.` : done.error
    })
  })
}
