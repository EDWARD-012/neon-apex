import type { Input } from './input'

// The phone's driving controls: a half steering wheel dragged with the
// left thumb, accelerator and brake pedals pressed with the right, and
// tilting the phone as another way to steer. Each one tracks its own
// finger, so steering and pedals work at the same time.

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v))

// How far along the drag the wheel reaches full lock, as a share of the
// wheel's width.
const FULL_LOCK = 0.42
// The pedals' travel: part throttle at the bottom of the pedal, full at the
// top.
export const PEDAL_LOW = 0.35

// Steering by dragging across the wheel. How far the thumb moves from where
// it landed is how far the wheels turn, and the wheel springs back to the
// middle when the thumb lifts.
export function bindWheel(el: HTMLElement, input: Input) {
  let finger: number | null = null
  let start = 0
  const show = (steer: number) => el.style.setProperty('--turn', `${(steer * 110).toFixed(1)}deg`)
  el.addEventListener('pointerdown', (e) => {
    if (finger !== null) return
    e.preventDefault()
    finger = e.pointerId
    start = e.clientX
    el.setPointerCapture(e.pointerId)
    input.analogSteer = 0
    show(0)
  })
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== finger) return
    const steer = clamp((e.clientX - start) / (el.clientWidth * FULL_LOCK))
    input.analogSteer = steer
    show(steer)
  })
  const release = (e: PointerEvent) => {
    if (e.pointerId !== finger) return
    finger = null
    input.analogSteer = null
    show(0)
  }
  el.addEventListener('pointerup', release)
  el.addEventListener('pointercancel', release)
}

// How hard a pedal is pressed from where the finger is on it: part throttle
// near the bottom, full near the top.
export function pedalAmount(y: number, top: number, height: number): number {
  const up = clamp(1 - (y - top) / height, 0, 1)
  return PEDAL_LOW + (1 - PEDAL_LOW) * up
}

// Accelerator and brake. One finger can slide from one pedal to the other
// without lifting, as a foot would.
export function bindPedals(box: HTMLElement, input: Input) {
  let finger: number | null = null
  const press = (e: PointerEvent) => {
    const pedal = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-pedal]')
    for (const p of box.querySelectorAll<HTMLElement>('[data-pedal]')) p.classList.toggle('down', p === pedal)
    input.analogThrottle = 0
    input.analogBrake = 0
    if (!pedal) return
    const r = pedal.getBoundingClientRect()
    const amount = pedalAmount(e.clientY, r.top, r.height)
    if (pedal.dataset.pedal === 'gas') input.analogThrottle = amount
    else input.analogBrake = amount
  }
  box.addEventListener('pointerdown', (e) => {
    if (finger !== null) return
    e.preventDefault()
    finger = e.pointerId
    box.setPointerCapture(e.pointerId)
    press(e)
  })
  box.addEventListener('pointermove', (e) => {
    if (e.pointerId === finger) press(e)
  })
  const release = (e: PointerEvent) => {
    if (e.pointerId !== finger) return
    finger = null
    input.analogThrottle = null
    input.analogBrake = null
    for (const p of box.querySelectorAll<HTMLElement>('[data-pedal]')) p.classList.remove('down')
  }
  box.addEventListener('pointerup', release)
  box.addEventListener('pointercancel', release)
}

// Steering by tilting the phone, held sideways: tipping it 30 degrees is
// full lock. iPhones ask the player's permission first, which has to come
// from a tap, so this is started from the Settings button.
let tiltHandler: ((e: DeviceOrientationEvent) => void) | null = null
export async function startTilt(input: Input): Promise<boolean> {
  const Orientation = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
  if (!Orientation) return false
  try {
    if (Orientation.requestPermission && (await Orientation.requestPermission()) !== 'granted') return false
  } catch {
    return false
  }
  stopTilt(input)
  tiltHandler = (e) => {
    // Held sideways, tipping the phone like a wheel shows up as beta; which
    // way round depends on which side the top is.
    const angle = (screen.orientation?.angle ?? 90) === 270 ? -(e.beta ?? 0) : e.beta ?? 0
    input.analogSteer = clamp(angle / 30)
  }
  window.addEventListener('deviceorientation', tiltHandler)
  return true
}

export function stopTilt(input: Input) {
  if (tiltHandler) window.removeEventListener('deviceorientation', tiltHandler)
  tiltHandler = null
  input.analogSteer = null
}

// A short buzz where the browser has one (Android Chrome does, iPhone
// Safari does not).
export function buzz(pattern: number | number[]) {
  if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(pattern)
}
