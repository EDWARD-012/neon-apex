import type { CarInput } from './sim/car'

// Keyboard, gamepad and on-screen touch buttons, merged into one CarInput.
// Keyboard steering ramps in and out over a fraction of a second, since a
// key is all or nothing and an instant full lock feels twitchy.

const KEYS: Record<string, string> = {
  ArrowUp: 'gas',
  KeyW: 'gas',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'drift',
  ShiftLeft: 'nitro',
  ShiftRight: 'nitro',
  KeyN: 'nitro',
  KeyV: 'lookback',
  KeyB: 'lookback',
}

export class Input {
  private held = new Set<string>()
  private touch = new Set<string>()
  private steer = 0
  // One-shot actions: reset, camera, pause.
  private pressed = new Set<string>()

  constructor() {
    window.addEventListener('pointerdown', () => this.pressed.add('any'))
    window.addEventListener('keydown', (e) => {
      // Typing into a form (the account screen) is not driving.
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      this.pressed.add('any')
      const action = KEYS[e.code]
      if (action) {
        this.held.add(action)
        e.preventDefault()
      }
      if (e.repeat) return
      if (e.code === 'KeyR') this.pressed.add('reset')
      if (e.code === 'KeyC') this.pressed.add('camera')
      if (e.code === 'Escape' || e.code === 'KeyP') this.pressed.add('pause')
    })
    window.addEventListener('keyup', (e) => {
      const action = KEYS[e.code]
      if (action) this.held.delete(action)
    })
    window.addEventListener('blur', () => this.held.clear())
  }

  // Wires the on-screen buttons: each has data-touch="gas" etc.
  bindTouch(root: HTMLElement) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = el.dataset.touch as string
      const down = (e: Event) => {
        e.preventDefault()
        this.touch.add(action)
        el.classList.add('down')
      }
      const up = (e: Event) => {
        e.preventDefault()
        this.touch.delete(action)
        el.classList.remove('down')
      }
      el.addEventListener('pointerdown', down)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('pointerleave', up)
    }
  }

  // True while a held action's key is down, for things like looking back.
  holding(action: string): boolean {
    const pad = navigator.getGamepads?.().find((p) => p)
    if (action === 'lookback' && pad?.buttons[4]?.pressed) return true
    return this.held.has(action) || this.touch.has(action)
  }

  // For on-screen buttons that fire a one-shot action, like the camera.
  press(action: string) {
    this.pressed.add(action)
  }

  take(action: string): boolean {
    if (this.gamepadPressed(action)) return true
    const had = this.pressed.has(action)
    this.pressed.delete(action)
    return had
  }

  private padWas: boolean[] = []
  private gamepadPressed(action: string): boolean {
    const pad = navigator.getGamepads?.().find((p) => p)
    if (!pad) return false
    const button = { reset: 3, camera: 2, pause: 9 }[action]
    if (button === undefined) return false
    const now = Boolean(pad.buttons[button]?.pressed)
    const was = this.padWas[button] ?? false
    this.padWas[button] = now
    return now && !was
  }

  read(dt: number): CarInput {
    const on = (a: string) => this.held.has(a) || this.touch.has(a)
    const want = (on('right') ? 1 : 0) - (on('left') ? 1 : 0)
    const rate = want === 0 ? 7 : Math.sign(want) !== Math.sign(this.steer) ? 9 : 5
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, want - this.steer))
    const input: CarInput = {
      throttle: on('gas') ? 1 : 0,
      brake: on('brake') ? 1 : 0,
      steer: this.steer,
      handbrake: on('drift'),
      nitro: on('nitro'),
      assist: true,
    }
    // A gamepad, if one is plugged in, takes over wherever it is being used.
    const pad = navigator.getGamepads?.().find((p) => p)
    if (pad) {
      const stick = pad.axes[0] ?? 0
      if (Math.abs(stick) > 0.12) input.steer = Math.sign(stick) * ((Math.abs(stick) - 0.12) / 0.88)
      const rt = pad.buttons[7]?.value ?? 0
      const lt = pad.buttons[6]?.value ?? 0
      if (rt > 0.05) input.throttle = rt
      if (lt > 0.05) input.brake = lt
      if (pad.buttons[0]?.pressed) input.nitro = true
      if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) input.handbrake = true
    }
    return input
  }
}
