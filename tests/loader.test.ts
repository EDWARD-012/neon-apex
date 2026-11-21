import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBytes, type LoadReport, onLoadProgress, report, resetLoads, setStep } from '../src/loader'

// A response that arrives in two chunks, with its length declared.
const chunked = (bytes: number[]) => {
  const half = Math.floor(bytes.length / 2)
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes.slice(0, half)))
      c.enqueue(new Uint8Array(bytes.slice(half)))
      c.close()
    },
  })
  return new Response(body, { headers: { 'content-length': String(bytes.length) } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLoads()
})

describe('the first-load downloads', () => {
  it('count the bytes as they arrive, against the declared size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chunked([1, 2, 3, 4, 5, 6, 7, 8])))
    const seen: LoadReport[] = []
    onLoadProgress((r) => seen.push(r))
    setStep('Downloading the cars')
    const bytes = await fetchBytes('/models/a.glb')
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(seen.some((r) => r.done === 4 && r.total === 8)).toBe(true)
    expect(report()).toMatchObject({ step: 'Downloading the cars', done: 8, total: 8, failed: [] })
  })

  it('try a failed file twice more before giving up', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        if (calls < 3) throw new Error('offline')
        return chunked([9, 9])
      }),
    )
    const bytes = await fetchBytes('/models/b.glb', 3, 1)
    expect(calls).toBe(3)
    expect(bytes.byteLength).toBe(2)
    expect(report().failed).toEqual([])
  })

  it('name a file that failed every try', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(fetchBytes('/models/c.glb', 3, 1)).rejects.toThrow('503')
    expect(report().failed).toEqual(['/models/c.glb'])
    expect(report().done).toBe(0)
  })
})
