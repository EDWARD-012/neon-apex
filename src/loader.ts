// Downloads for the first load, with progress and retries, so the loading
// screen can show a real bar and name what it is doing.

export interface LoadReport {
  step: string
  // Bytes so far and in all, for every download started.
  done: number
  total: number
  // Files that failed after every retry.
  failed: string[]
}

const sizes = new Map<string, number>()
const got = new Map<string, number>()
const failed: string[] = []
let step = 'Getting things ready'
let listener: ((r: LoadReport) => void) | null = null

export function report(): LoadReport {
  let done = 0
  let total = 0
  for (const [url, n] of got) {
    done += n
    // A compressed response can come out longer than its Content-Length.
    total += Math.max(n, sizes.get(url) ?? 0)
  }
  return { step, done, total, failed: [...failed] }
}

const emit = () => listener?.(report())

export function onLoadProgress(fn: (r: LoadReport) => void) {
  listener = fn
  emit()
}

export function setStep(name: string) {
  step = name
  emit()
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

// Fetches a file as bytes, counting them as they arrive. A failure is tried
// again twice, a little later each time, before it gives up.
export async function fetchBytes(url: string, tries = 3, pause = 800): Promise<ArrayBuffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      sizes.set(url, Number(response.headers.get('content-length')) || 0)
      got.set(url, 0)
      emit()
      if (!response.body) {
        const whole = await response.arrayBuffer()
        got.set(url, whole.byteLength)
        emit()
        return whole
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        length += value.byteLength
        got.set(url, length)
        emit()
      }
      const bytes = new Uint8Array(length)
      let at = 0
      for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.byteLength
      }
      return bytes.buffer
    } catch (error) {
      got.set(url, 0)
      if (attempt >= tries) {
        failed.push(url)
        emit()
        throw error
      }
      await wait(pause * attempt)
    }
  }
}

// For the tests: forget every download.
export function resetLoads() {
  sizes.clear()
  got.clear()
  failed.length = 0
  step = 'Getting things ready'
  listener = null
}
