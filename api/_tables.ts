import { sql, table as playersTable } from './_lib.js'

// The tables for leaderboards, friends and challenges, each created on
// first use like the players table, so a fresh database needs no setup.

let laps: Promise<unknown> | null = null
// The best time-trial lap of each player on each track and physics version,
// and for some of them the run itself, for ghosts.
export function lapsTable() {
  laps ??= playersTable()
    .then(
      () => sql`create table if not exists laps (
        seed text not null,
        physics integer not null,
        player_id bigint not null references players (id) on delete cascade,
        time double precision not null,
        car text not null,
        fitted jsonb,
        set_at timestamptz not null default now(),
        primary key (seed, physics, player_id)
      )`,
    )
    // The best run itself, gzipped JSON in base64, for ghosts. Laps stored
    // before ghosts existed have none.
    .then(() => sql`alter table laps add column if not exists ghost text`)
  return laps
}

let social: Promise<unknown> | null = null
// Friends are one-way: adding someone by username follows their laps, and
// they are not asked or told. A challenge sends one of your checked laps on
// a track, by its time, to someone you have added.
export function socialTables() {
  social ??= lapsTable()
    .then(
      () => sql`create table if not exists friends (
        player_id bigint not null references players (id) on delete cascade,
        friend_id bigint not null references players (id) on delete cascade,
        added_at timestamptz not null default now(),
        primary key (player_id, friend_id)
      )`,
    )
    .then(
      () => sql`create table if not exists challenges (
        id bigserial primary key,
        from_id bigint not null references players (id) on delete cascade,
        to_id bigint not null references players (id) on delete cascade,
        seed text not null,
        physics integer not null,
        time double precision not null,
        sent_at timestamptz not null default now(),
        dismissed boolean not null default false,
        unique (from_id, to_id, seed, physics)
      )`,
    )
  return social
}
