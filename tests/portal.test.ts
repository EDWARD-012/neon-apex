import { afterEach, describe, expect, it, vi } from 'vitest'

// The portal build is the normal build with Vite's mode set to "portal".
// Each test loads the modules fresh under one mode, as if on a game site.
async function load(mode: string) {
  vi.resetModules()
  vi.stubEnv('MODE', mode)
  vi.stubGlobal('location', { search: '', hostname: 'html-classic.itch.zone' })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
  const beacon = vi.fn(() => true)
  vi.stubGlobal('navigator', { sendBeacon: beacon })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const portal = await import('../src/portal')
  const cloud = await import('../src/cloud')
  const analytics = await import('../src/analytics')
  const boards = await import('../src/leaderboard')
  return { portal, cloud, analytics, boards, beacon, fetch }
}

describe('the portal build', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('turns accounts, play events and the leaderboards off', async () => {
    const { portal, cloud, analytics, boards, beacon, fetch } = await load('portal')
    expect(portal.PORTAL).toBe(true)
    expect(cloud.cloudEnabled).toBe(false)
    expect(await cloud.currentAccount()).toBeNull()
    analytics.report('visit')
    expect(boards.boardsEnabled).toBe(false)
    expect(await boards.fetchBoard('night-2026-11-21')).toBeNull()
    expect(beacon).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves them on in the website build', async () => {
    const { portal, cloud, analytics, boards, beacon } = await load('production')
    expect(portal.PORTAL).toBe(false)
    expect(cloud.cloudEnabled).toBe(true)
    expect(boards.boardsEnabled).toBe(true)
    analytics.report('visit')
    expect(beacon).toHaveBeenCalledOnce()
  })
})
