// Anonymous play events, so we can see how the game is played: how long
// people stay, which events they race, and whether they come back. A
// random id is kept in this browser; no name, email or account is sent.
// Off in the browser tests, on a local machine and in the portal build,
// none of which has the server.

import { PORTAL } from './portal'

const STORE = 'neon-apex/visitor'
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
const enabled = !PORTAL && !new URLSearchParams(location.search).has('test') && !local

function randomId(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)
}

function visitorId(): string {
  try {
    const saved = localStorage.getItem(STORE)
    if (saved && /^[a-z0-9]{8,32}$/.test(saved)) return saved
    const id = randomId()
    localStorage.setItem(STORE, id)
    return id
  } catch {
    return randomId()
  }
}

const visitor = enabled ? visitorId() : ''
const session = randomId()

type Detail = Record<string, string | number | boolean | null>

export function report(name: 'visit' | 'race_start' | 'race_end' | 'minute', kind: string | null = null, value: number | null = null, detail: Detail | null = null) {
  if (!enabled) return
  const body = JSON.stringify({ visitor, session, name, kind, value, detail })
  try {
    // sendBeacon survives the page closing; fetch with keepalive is the
    // fallback where it is missing.
    if (navigator.sendBeacon?.('/api/event', body)) return
    void fetch('/api/event', { method: 'POST', body, keepalive: true }).catch(() => undefined)
  } catch {
    // Analytics never gets in the way of the game.
  }
}

// One ping for each minute the page is visible, for time played.
export function startClock() {
  if (!enabled) return
  window.setInterval(() => {
    if (document.visibilityState === 'visible') report('minute')
  }, 60000)
}
