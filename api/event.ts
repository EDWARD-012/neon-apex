import { cleanEvent } from './_core.js'
import { sql } from './_lib.js'

// Stores one play event. Sent with sendBeacon when the page is closing, so
// the body may come as plain text; it is parsed either way.
let ready: Promise<unknown> | null = null
function table() {
  ready ??= sql`create table if not exists events (
    id bigserial primary key,
    at timestamptz not null default now(),
    visitor text not null,
    session text not null,
    name text not null,
    kind text,
    value real,
    detail jsonb
  )`
  return ready
}

export async function POST(request: Request) {
  let raw: unknown = null
  try {
    raw = JSON.parse(await request.text())
  } catch {
    raw = null
  }
  const event = cleanEvent(raw)
  if (!event) return new Response(null, { status: 400 })
  await table()
  await sql`insert into events (visitor, session, name, kind, value, detail) values (${event.visitor}, ${event.session}, ${event.name}, ${event.kind}, ${event.value}, ${event.detail ? JSON.stringify(event.detail) : null}::jsonb)`
  return new Response(null, { status: 204 })
}
