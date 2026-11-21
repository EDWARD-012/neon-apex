// Prints what the play events say, day by day: visitors, sessions, minutes
// played, races started and finished, and how many of a day's visitors came
// back the next day. Then, over the whole period, each kind of event (how
// often it is started and finished, and how long a finished one lasts) and
// how many visitors came on more than one day. Only totals, never one
// visitor. Reads DATABASE_URL from .env.local (pulled from Vercel).
// Run with: npm run analytics
import { lookup as systemLookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { Resolver } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { neon, neonConfig } from '@neondatabase/serverless'

// Some home routers' DNS answers "not found" for Neon's hosts while public
// resolvers know them. The queries go over HTTPS, so this script gives the
// driver a fetch whose lookup asks the system first and, only if that
// fails, asks public DNS for that one host. TLS still checks the host name.
const publicDns = new Resolver()
publicDns.setServers(['1.1.1.1', '8.8.8.8'])

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
function lookup(host: string, options: LookupOptions, callback: LookupCallback) {
  systemLookup(host, { ...options, all: true }, (error, found) => {
    const answer = (list: LookupAddress[]) => (options.all ? callback(null, list) : callback(null, list[0].address, list[0].family))
    if (!error && found.length > 0) return answer(found)
    publicDns.resolve4(host).then(
      (ips) => answer(ips.map((address) => ({ address, family: 4 }))),
      () => callback(error ?? new Error(`Could not resolve ${host}`), ''),
    )
  })
}

function fetchWithFallback(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const req = request(new URL(url), { method: init.method ?? 'GET', headers, lookup }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const out = new Headers()
        for (const [key, value] of Object.entries(res.headers)) for (const v of [value].flat()) if (v !== undefined) out.append(key, v)
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers: out }))
      })
    })
    req.on('error', reject)
    if (typeof init.body === 'string') req.write(init.body)
    req.end()
  })
}
neonConfig.fetchFunction = fetchWithFallback

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error('No DATABASE_URL in the environment or .env.local')
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '')
}

const sql = neon(databaseUrl())
const days = Number(process.argv[2]) || 14

const rows = (await sql`
  with day as (
    select date_trunc('day', at)::date as d, visitor, session, name from events
    where at > now() - make_interval(days => ${days})
  )
  -- As text, so the date doesn't shift with this computer's time zone.
  select to_char(d, 'YYYY-MM-DD') as day,
    count(distinct visitor) as visitors,
    count(distinct session) as sessions,
    count(*) filter (where name = 'minute') as minutes,
    count(*) filter (where name = 'race_start') as started,
    count(*) filter (where name = 'race_end') as finished,
    (select count(distinct a.visitor) from day a where a.d = day.d and exists (
      select 1 from day b where b.visitor = a.visitor and b.d = a.d + 1)) as back_next_day
  from day group by d order by d
`) as Record<string, string | number>[]

console.log('| Day | Visitors | Sessions | Minutes a session | Races started | Races finished | Back next day |')
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  const sessions = Number(r.sessions)
  const visitors = Number(r.visitors)
  const perSession = sessions ? (Number(r.minutes) / sessions).toFixed(1) : '0'
  const back = visitors ? `${Math.round((Number(r.back_next_day) / visitors) * 100)}%` : '-'
  console.log(`| ${r.day} | ${visitors} | ${sessions} | ${perSession} | ${r.started} | ${r.finished} | ${back} |`)
}
if (rows.length === 0) console.log('No events yet.')

const kinds = (await sql`
  select kind,
    count(*) filter (where name = 'race_start') as started,
    count(*) filter (where name = 'race_end') as finished,
    avg(value) filter (where name = 'race_end') as seconds
  from events
  where at > now() - make_interval(days => ${days}) and kind is not null and name in ('race_start', 'race_end')
  group by kind order by started desc
`) as Record<string, string | number | null>[]
console.log('')
console.log('| Event | Started | Finished | Average length of a finished one |')
console.log('| --- | --- | --- | --- |')
for (const k of kinds) {
  const seconds = k.seconds === null ? null : Number(k.seconds)
  console.log(`| ${k.kind} | ${k.started} | ${k.finished} | ${seconds === null ? '-' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`} |`)
}

const [back] = (await sql`
  select count(*) as visitors, count(*) filter (where days > 1) as returning
  from (select visitor, count(distinct date_trunc('day', at)) as days from events
    where at > now() - make_interval(days => ${days}) group by visitor) v
`) as Record<string, string | number>[]
console.log('')
console.log(`Visitors seen on more than one day: ${back.returning} of ${back.visitors}.`)
