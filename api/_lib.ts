import { neon } from '@neondatabase/serverless'
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'
import { GOOGLE_CLIENT_ID, readCookie } from './_core.js'

// Database, sessions and responses shared by the account endpoints.

const COOKIE = 'na_session'
const DAYS = 90

export const sql = neon(process.env.DATABASE_URL as string)

// The one table. Created on first use, so a fresh database needs no setup.
let ready: Promise<unknown> | null = null
export function table() {
  ready ??= sql`create table if not exists players (
    id bigserial primary key,
    google_sub text unique,
    email text,
    username text unique,
    password_hash text,
    progress jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`
  return ready
}

export interface Player {
  id: string
  username: string | null
  progress: unknown
}

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(value)
}

export async function sessionCookie(playerId: string) {
  const token = await new SignJWT({ pid: playerId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${DAYS}d`).sign(secret())
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`
}
export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

export async function currentPlayer(request: Request): Promise<Player | null> {
  const token = readCookie(request.headers.get('cookie'), COOKIE)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    await table()
    const rows = await sql`select id, username, progress from players where id = ${String(payload.pid)}`
    return (rows[0] as Player | undefined) ?? null
  } catch {
    return null
  }
}

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
// Checks a Google sign-in token: signed by Google, for this app, not expired,
// with a verified email.
export async function verifyGoogle(credential: string) {
  const { payload } = await jwtVerify(credential, googleKeys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: GOOGLE_CLIENT_ID })
  if (!payload.sub || payload.email_verified !== true) throw new Error('unverified')
  return { sub: payload.sub, email: String(payload.email ?? '') }
}

export function json(body: unknown, status = 200, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' }
  if (cookie) headers['set-cookie'] = cookie
  return new Response(JSON.stringify(body), { status, headers })
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function view(player: Player) {
  return { username: player.username, needsSetup: !player.username, progress: player.progress ?? null }
}
