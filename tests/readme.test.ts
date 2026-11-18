import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { statsTable } from '../scripts/stats'

// The README quotes the stats script. This reruns it and fails if the
// README has drifted from what it prints.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('README', () => {
  it('quotes the current stats table', () => {
    expect(readme).toContain(statsTable())
  })

  it('points only at images that exist', () => {
    for (const [, path] of readme.matchAll(/src="(docs\/[^"]+)"/g)) {
      expect(() => readFileSync(new URL(`../${path}`, import.meta.url))).not.toThrow()
    }
  })
})
