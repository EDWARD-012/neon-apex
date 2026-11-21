import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildUpdatesPage, dayHeading, readChanges, renderChanges } from '../scripts/changelog'

describe('the updates page', () => {
  const sample = () => {
    const dir = mkdtempSync(join(tmpdir(), 'changes-'))
    const add = (day: string, file: string, text: string) => {
      mkdirSync(join(dir, day), { recursive: true })
      writeFileSync(join(dir, day, file), text)
    }
    add('2026-11-20', '0900-old.html', '<li>Older day</li>\n')
    add('2026-11-21', '0600-morning.html', '<li>Morning</li>\n')
    add('2026-11-21', '1530-afternoon.html', '<li>Afternoon</li>\n')
    add('2026-11-21', '1530-also.html', '<li>Same minute</li>\n')
    add('2026-11-18', '0100-first.html', '<li>First</li>\n')
    add('2026-11-18', '_heading.txt', '18 November 2026: the first version\n')
    add('2026-11-19', 'notes.txt', 'not an entry')
    return dir
  }

  it('runs days newest first, and entries by time, newest first, then by name', () => {
    const days = readChanges(sample())
    expect(days.map((d) => d.day)).toEqual(['2026-11-21', '2026-11-20', '2026-11-18'])
    expect(days[0].entries.map((e) => e.file)).toEqual(['1530-afternoon.html', '1530-also.html', '0600-morning.html'])
    expect(days[2].heading).toBe('18 November 2026: the first version')
    expect(dayHeading('2026-11-21')).toBe('21 November 2026')
  })

  it('renders each day as a heading over its list, and fills the template', () => {
    const dir = sample()
    const html = renderChanges(readChanges(dir))
    expect(html).toContain('<h2 id="2026-11-21">21 November 2026</h2>')
    expect(html.indexOf('Afternoon')).toBeLessThan(html.indexOf('Morning'))
    const template = join(dir, 'template.html')
    writeFileSync(template, '<main><!-- CHANGES --></main>')
    expect(buildUpdatesPage(template, dir)).toBe(`<main>${html}</main>`)
  })

  it('every change in the repo is a list item in a correctly named file', () => {
    for (const day of readdirSync('changes')) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      for (const file of readdirSync(join('changes', day))) {
        if (file === '_heading.txt') continue
        expect(file).toMatch(/^\d{4}-[a-z0-9-]+\.html$/)
        const text = readFileSync(join('changes', day, file), 'utf8').trim()
        expect(text.startsWith('<li>') && text.endsWith('</li>')).toBe(true)
      }
    }
  })
})
