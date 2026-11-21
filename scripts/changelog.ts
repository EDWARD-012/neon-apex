import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The updates page is built from one small file per change, so pull
// requests that each add an update never edit the same lines.
//
//   changes/2026-11-21/1530-crash-police.html   one or more <li> lines
//   changes/2026-11-18/_heading.txt             optional heading text
//
// Days run newest first. Within a day, entries run by the four-digit time
// in front of the name (UTC, HHMM), newest first, then by name.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const ENTRY = /^(\d{4})-[a-z0-9-]+\.html$/
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function dayHeading(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export interface Day {
  day: string
  heading: string
  entries: { file: string; html: string }[]
}

export function readChanges(dir: string): Day[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((d) => DAY.test(d))
    .sort()
    .reverse()
    .map((day) => {
      const files = readdirSync(join(dir, day))
      const custom = files.includes('_heading.txt') ? readFileSync(join(dir, day, '_heading.txt'), 'utf8').trim() : ''
      const entries = files
        .filter((f) => ENTRY.test(f))
        .sort((a, b) => b.slice(0, 4).localeCompare(a.slice(0, 4)) || a.localeCompare(b))
        .map((file) => ({ file, html: readFileSync(join(dir, day, file), 'utf8').trim() }))
      return { day, heading: custom || dayHeading(day), entries }
    })
    .filter((d) => d.entries.length > 0)
}

export function renderChanges(days: Day[]): string {
  return days
    .map((d) => {
      const items = d.entries.map((e) => `          ${e.html.split('\n').join('\n          ')}`).join('\n')
      return `        <h2 id="${d.day}">${d.heading}</h2>\n        <ul>\n${items}\n        </ul>`
    })
    .join('\n\n')
}

// The whole page: the template with the list where its marker is.
export function buildUpdatesPage(templatePath: string, dir: string): string {
  const template = readFileSync(templatePath, 'utf8')
  if (!template.includes('<!-- CHANGES -->')) throw new Error(`${templatePath} has no <!-- CHANGES --> marker`)
  return template.replace('<!-- CHANGES -->', renderChanges(readChanges(dir)))
}
