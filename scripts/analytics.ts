// Prints what the play events say, day by day: visitors, sessions, minutes
// played, races started and finished, and how many of a day's visitors came
// back the next day. Reads DATABASE_URL from .env.local (pulled from Vercel).
// Run with: npm run analytics
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

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
  select d,
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
  console.log(`| ${String(r.d).slice(0, 10)} | ${visitors} | ${sessions} | ${perSession} | ${r.started} | ${r.finished} | ${back} |`)
}
if (rows.length === 0) console.log('No events yet.')
