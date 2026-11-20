// All sound is synthesised with the Web Audio API: an engine made of two
// detuned oscillators through a low-pass filter, tyre squeal from filtered
// noise, a whoosh for nitro and a thump for hits, wind that rises with
// speed, whooshes as cars pass, and a siren that bends in pitch as a
// patrol car closes or falls back. No recorded audio.

// What each car sounds like. Pitch follows the revs within each gear; the
// two engine oscillators are mixed and filtered, a slow wobble on the
// volume gives a V8 its lope, a sine adds an electric motor's whine, and
// band-passed noise is a turbo's whistle.
export type EngineKind = 'v12' | 'turbo4' | 'v8' | 'electric'
interface EngineVoice {
  base: number
  range: number
  waveA: OscillatorType
  waveB: OscillatorType
  ratioB: number
  mixB: number
  filter: number
  filterRange: number
  q: number
  gain: number
  // Volume wobble depth and its rate as a fraction of the engine pitch.
  lope: number
  lopeRate: number
  whine: number
  turbo: number
}
const VOICES: Record<EngineKind, EngineVoice> = {
  v12: { base: 70, range: 210, waveA: 'sawtooth', waveB: 'sawtooth', ratioB: 2.003, mixB: 0.45, filter: 500, filterRange: 2600, q: 3, gain: 1, lope: 0.05, lopeRate: 0.5, whine: 0, turbo: 0 },
  turbo4: { base: 85, range: 230, waveA: 'square', waveB: 'sawtooth', ratioB: 1.498, mixB: 0.3, filter: 650, filterRange: 1800, q: 5, gain: 0.85, lope: 0.08, lopeRate: 0.5, whine: 0, turbo: 0.09 },
  v8: { base: 42, range: 120, waveA: 'sawtooth', waveB: 'square', ratioB: 1.505, mixB: 0.5, filter: 300, filterRange: 1100, q: 6, gain: 1.25, lope: 0.45, lopeRate: 0.25, whine: 0, turbo: 0 },
  electric: { base: 160, range: 900, waveA: 'sine', waveB: 'triangle', ratioB: 3.01, mixB: 0.25, filter: 1400, filterRange: 3000, q: 1, gain: 0.55, lope: 0, lopeRate: 0, whine: 0.5, turbo: 0 },
}

export class Sound {
  private ctx: AudioContext | null = null
  private voice: EngineVoice = VOICES.v12
  private mixB!: GainNode
  private lope!: OscillatorNode
  private lopeDepth!: GainNode
  private whine!: OscillatorNode
  private whineGain!: GainNode
  private turboGain!: GainNode
  private turboFilter!: BiquadFilterNode
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
  private sirenOsc!: OscillatorNode
  private sirenDepth!: GainNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private rotorGain!: GainNode
  private rotorDepth!: GainNode
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
    // The lope: an oscillator moving the volume up and down a little.
    const loped = ctx.createGain()
    loped.gain.value = 1
    this.lope = ctx.createOscillator()
    this.lopeDepth = ctx.createGain()
    this.lopeDepth.gain.value = 0
    this.lope.connect(this.lopeDepth).connect(loped.gain)
    this.engineFilter.connect(loped).connect(this.engineGain).connect(this.master)
    this.engineA = ctx.createOscillator()
    this.engineB = ctx.createOscillator()
    this.mixB = ctx.createGain()
    this.engineA.connect(this.engineFilter)
    this.engineB.connect(this.mixB).connect(this.engineFilter)
    this.whine = ctx.createOscillator()
    this.whine.type = 'sine'
    this.whineGain = ctx.createGain()
    this.whineGain.gain.value = 0
    this.whine.connect(this.whineGain).connect(this.master)
    this.engineA.start()
    this.engineB.start()
    this.lope.start()
    this.whine.start()

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    this.turboFilter = ctx.createBiquadFilter()
    this.turboGain = this.loop('bandpass', 3800, 14, this.turboFilter)
    this.setEngine(this.kind)
    this.squealGain = this.loop('bandpass', 2100, 6)
    this.boostGain = this.loop('highpass', 1400, 0.7)
    this.rainGain = this.loop('lowpass', 1600, 0.4)
    // Wind: low-passed noise that gets louder and brighter with speed.
    this.windFilter = ctx.createBiquadFilter()
    this.windGain = this.loop('lowpass', 300, 0.6, this.windFilter)

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
    this.sirenOsc = siren
    this.sirenDepth = depth

    // Rotor: low noise chopped by the blades about eleven times a second.
    // The chop is added to the loop's own gain, so both follow the level.
    this.rotorGain = this.loop('lowpass', 170, 0.9)
    const blades = ctx.createOscillator()
    blades.type = 'square'
    blades.frequency.value = 11
    this.rotorDepth = ctx.createGain()
    this.rotorDepth.gain.value = 0
    blades.connect(this.rotorDepth).connect(this.rotorGain.gain)
    blades.start()
  }

  // The police helicopter overhead, level 0 to 1 from how close it is.
  rotor(level: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.rotorGain.gain.setTargetAtTime(level * 0.32, t, 0.3)
    this.rotorDepth.gain.setTargetAtTime(level * 0.26, t, 0.3)
  }

  setRain(on: boolean) {
    if (this.ctx) this.rainGain.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.4)
  }

  // level 0 to 1, from how close the nearest patrol car is. pitch is a
  // Doppler shift from how fast it is closing (above 1) or dropping back
  // (below 1), exaggerated so it reads.
  siren(level: number, pitch = 1) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.sirenGain.gain.setTargetAtTime(level * 0.07, t, 0.2)
    this.sirenOsc.frequency.setTargetAtTime(760 * pitch, t, 0.15)
    this.sirenDepth.gain.setTargetAtTime(260 * pitch, t, 0.15)
  }

  // Wind round the car, from its speed in m/s.
  wind(speed: number, active: boolean) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const k = Math.min(1, speed / 80)
    this.windGain.gain.setTargetAtTime(active ? 0.2 * k * k : 0, t, 0.15)
    this.windFilter.frequency.setTargetAtTime(300 + 2200 * k, t, 0.15)
  }

  // Another car going past close: a short rush of air, louder the faster
  // it passes. level 0 to 1.
  passby(level: number) {
    this.burst('bandpass', 700 + 900 * level, 0.08 + 0.2 * level, 0.5)
  }

  // A turbocharged engine's flutter when the throttle snaps shut at high
  // revs: a whistle chopped quickly on and off. Only engines with a turbo.
  flutter() {
    if (!this.ctx || !this.enabled || this.voice.turbo === 0) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2400
    filter.Q.value = 4
    const gain = ctx.createGain()
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t)
    for (let k = 0; k < 8; k++) {
      gain.gain.setValueAtTime(0.16 * (1 - k / 8), t + k * 0.045)
      gain.gain.setValueAtTime(0.0001, t + k * 0.045 + 0.022)
    }
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    src.stop(t + 0.45)
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

  private kind: EngineKind = 'v12'
  // Picks the engine sound for the car being driven.
  setEngine(kind: EngineKind) {
    this.kind = kind
    this.voice = VOICES[kind]
    if (!this.ctx) return
    const v = this.voice
    this.engineA.type = v.waveA
    this.engineB.type = v.waveB
    this.mixB.gain.value = v.mixB
    this.engineFilter.Q.value = v.q
    this.lopeDepth.gain.value = v.lope
  }

  private loop(type: BiquadFilterType, freq: number, q: number, given?: BiquadFilterNode): GainNode {
    const ctx = this.ctx as AudioContext
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = given ?? ctx.createBiquadFilter()
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
    const v = this.voice
    const base = v.base + rpm * v.range
    this.engineA.frequency.setTargetAtTime(base, t, 0.03)
    this.engineB.frequency.setTargetAtTime(base * v.ratioB, t, 0.03)
    this.lope.frequency.setTargetAtTime(base * v.lopeRate, t, 0.05)
    this.engineFilter.frequency.setTargetAtTime(v.filter + rpm * v.filterRange + throttle * 700, t, 0.05)
    this.engineGain.gain.setTargetAtTime(active ? (0.1 + throttle * 0.12) * v.gain : 0, t, 0.08)
    this.whine.frequency.setTargetAtTime(base * 4, t, 0.04)
    this.whineGain.gain.setTargetAtTime(active ? v.whine * (0.02 + rpm * 0.05) : 0, t, 0.08)
    this.turboGain.gain.setTargetAtTime(active ? v.turbo * throttle * rpm * rpm : 0, t, 0.12)
    this.turboFilter.frequency.setTargetAtTime(2600 + rpm * 3200, t, 0.08)
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
