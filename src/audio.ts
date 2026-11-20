// All sound is synthesised with the Web Audio API: an engine made of two
// detuned oscillators through a low-pass filter, tyre squeal from filtered
// noise, a whoosh for nitro and a thump for hits. No recorded audio.

export class Sound {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private engineA!: OscillatorNode
  private engineB!: OscillatorNode
  private engineGain!: GainNode
  private engineFilter!: BiquadFilterNode
  private squealGain!: GainNode
  private boostGain!: GainNode
  private noise!: AudioBuffer
  private rainGain!: GainNode
  private sirenGain!: GainNode
  private volume = 0.55
  enabled = true

  // Browsers only allow audio after a user gesture, so this is called from
  // the first click or key press.
  start() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? this.volume : 0
    this.master.connect(ctx.destination)

    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.Q.value = 4
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineFilter.connect(this.engineGain).connect(this.master)
    this.engineA = ctx.createOscillator()
    this.engineA.type = 'sawtooth'
    this.engineB = ctx.createOscillator()
    this.engineB.type = 'square'
    const mixB = ctx.createGain()
    mixB.gain.value = 0.35
    this.engineA.connect(this.engineFilter)
    this.engineB.connect(mixB).connect(this.engineFilter)
    this.engineA.start()
    this.engineB.start()

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    this.squealGain = this.loop('bandpass', 2100, 6)
    this.boostGain = this.loop('highpass', 1400, 0.7)
    this.rainGain = this.loop('lowpass', 1600, 0.4)

    // Siren: a square wave whose pitch is swept up and down by a slow
    // oscillator, through a band-pass so it sounds distant and tinny.
    const siren = ctx.createOscillator()
    siren.type = 'square'
    siren.frequency.value = 760
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.55
    const depth = ctx.createGain()
    depth.gain.value = 260
    lfo.connect(depth).connect(siren.frequency)
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 1.2
    this.sirenGain = ctx.createGain()
    this.sirenGain.gain.value = 0
    siren.connect(band).connect(this.sirenGain).connect(this.master)
    siren.start()
    lfo.start()
  }

  setRain(on: boolean) {
    if (this.ctx) this.rainGain.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.4)
  }

  // level 0 to 1, from how close the nearest patrol car is.
  siren(level: number) {
    if (this.ctx) this.sirenGain.gain.setTargetAtTime(level * 0.07, this.ctx.currentTime, 0.2)
  }

  thunder() {
    this.burst('lowpass', 180, 0.5, 2.8)
  }

  whoosh() {
    this.burst('highpass', 1800, 0.18, 0.45)
  }

  // Nitro lighting up: a deep thump under a rising hiss.
  ignite() {
    this.burst('lowpass', 120, 0.5, 0.6)
    this.burst('highpass', 900, 0.3, 1.1)
  }

  // An exhaust backfire.
  pop(level = 1) {
    this.burst('bandpass', 260 + Math.random() * 120, 0.35 * level, 0.18)
  }

  private burst(type: BiquadFilterType, freq: number, level: number, seconds: number) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds)
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    src.stop(ctx.currentTime + seconds + 0.1)
  }

  private loop(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx as AudioContext
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    return gain
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (this.ctx) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05)
  }

  // rpm runs 0..1 within the current gear.
  update(rpm: number, throttle: number, slip: number, boost: boolean, active: boolean) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const base = 55 + rpm * 150
    this.engineA.frequency.setTargetAtTime(base, t, 0.03)
    this.engineB.frequency.setTargetAtTime(base * 1.505, t, 0.03)
    this.engineFilter.frequency.setTargetAtTime(350 + rpm * 1400 + throttle * 900, t, 0.05)
    this.engineGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.12 : 0, t, 0.08)
    this.squealGain.gain.setTargetAtTime(active ? Math.min(0.22, Math.max(0, slip - 0.12) * 0.7) : 0, t, 0.05)
    this.boostGain.gain.setTargetAtTime(active && boost ? 0.16 : 0, t, 0.1)
  }

  hit(strength: number) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 500
    const gain = ctx.createGain()
    const level = Math.min(0.6, strength * 0.05)
    gain.gain.setValueAtTime(level, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    src.stop(ctx.currentTime + 0.4)
  }

  // A short rising beep for the countdown, higher for the green light.
  beep(high: boolean) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = high ? 880 : 440
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (high ? 0.6 : 0.25))
    osc.connect(gain).connect(this.master)
    osc.start()
    osc.stop(ctx.currentTime + 0.7)
  }
}
