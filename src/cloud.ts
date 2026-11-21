import type { Progress } from './career'
import { PORTAL } from './portal'

// Accounts and cloud saves. Signing in with Google creates the account; the
// first time, the player also picks a username and password for signing in
// on devices without Google. Progress is still kept in local storage, and
// copied to the account whenever it changes.

export const GOOGLE_CLIENT_ID = '671666832169-u9r4dca9gj7s48eg6156p04mbq757mc1.apps.googleusercontent.com'

export interface Account {
  username: string | null
  needsSetup: boolean
  progress: Progress | null
}

// Off in tests and in the plain Vite preview, which have no /api, and in
// the portal build, which has none either.
export const cloudEnabled = !PORTAL && !new URLSearchParams(location.search).has('test')

async function call(path: string, method = 'GET', data?: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: data === undefined ? undefined : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const type = response.headers.get('content-type') ?? ''
    const body = type.includes('application/json') ? ((await response.json()) as Record<string, unknown>) : {}
    return { ok: response.ok, body }
  } catch {
    return { ok: false, body: { error: 'Could not reach the server. Check your connection.' } }
  }
}

const account = (body: Record<string, unknown>): Account => ({
  username: (body.username as string | null) ?? null,
  needsSetup: Boolean(body.needsSetup),
  progress: (body.progress as Progress | null) ?? null,
})

export class AccountError extends Error {}
const fail = (body: Record<string, unknown>) => new AccountError(String(body.error ?? 'Something went wrong. Try again.'))

export async function currentAccount(): Promise<Account | null> {
  if (!cloudEnabled) return null
  const { ok, body } = await call('/api/me')
  return ok && body.signedIn ? account(body) : null
}

export async function signInWithGoogle(credential: string): Promise<Account> {
  const { ok, body } = await call('/api/auth/google', 'POST', { credential })
  if (!ok) throw fail(body)
  return account(body)
}

export async function chooseLogin(username: string, password: string): Promise<Account> {
  const { ok, body } = await call('/api/auth/setup', 'POST', { username, password })
  if (!ok) throw fail(body)
  return account(body)
}

export async function signIn(username: string, password: string): Promise<Account> {
  const { ok, body } = await call('/api/auth/login', 'POST', { username, password })
  if (!ok) throw fail(body)
  return account(body)
}

export async function signOut() {
  await call('/api/auth/logout', 'POST')
}

// Saves are sent a moment after the last change, so a burst of changes is
// one request.
let pending: Progress | null = null
let timer = 0
export function uploadProgress(progress: Progress) {
  if (!cloudEnabled) return
  pending = progress
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    const p = pending
    pending = null
    if (p) void call('/api/progress', 'PUT', { progress: p })
  }, 1200)
}

// Google's sign-in button, loaded only when the account screen opens.
let gis: Promise<void> | null = null
type Gis = {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
    }
  }
}
export function googleButton(el: HTMLElement, onCredential: (credential: string) => void) {
  gis ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in did not load'))
    document.head.append(script)
  })
  return gis.then(() => {
    const google = (window as unknown as { google: Gis }).google
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => onCredential(r.credential) })
    el.innerHTML = ''
    google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 })
  })
}
