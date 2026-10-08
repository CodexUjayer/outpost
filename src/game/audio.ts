// ============================================================
// Procedural audio engine — Off-World Colony STEM Game (Task 3-a)
// 100% synthesized with Web Audio API. No files, no fetch, no assets.
//
// Design:
//  - one shared AudioContext; master chain: masterGain -> compressor -> destination
//  - two shared 2s noise buffers (white + brown) reused by every noise sound
//  - persistent ambience layers (wind / storm / room tone / fan) crossfaded
//    with setTargetAtTime — never hard switches
//  - every public method is safe to call any time (no-ops before init()),
//    cheap when called every frame (state caching + epsilon gates)
//  - one-shots capped (~24 concurrent), auto-cleanup via onended
// ============================================================

export type AudioPosition = { x: number; y: number; z: number }
export type SurfaceType = 'regolith' | 'metal'
export type Planet = 'moon' | 'mars'

// ---------- tiny helpers ----------

const clamp01 = (v: number): number => {
  if (typeof v !== 'number' || !isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const num = (v: number, d: number): number =>
  typeof v === 'number' && isFinite(v) ? v : d

interface LoopParts {
  sources: AudioScheduledSourceNode[]
  cleanup: AudioNode[]
  params: Record<string, AudioParam>
}

interface LoopNode extends LoopParts {
  id: string
  ctrl: GainNode // fade / master control gain for the loop
  panner: PannerNode | null
}

// real recorded machinery/industrial clips in public/sounds/machinery
// (generators, pumps, compressors, ventilation, hydraulics — downloaded
// from the internet; see tools/fetch-sounds.sh)
const MACHINERY_CLIPS = [
  'generator.mp3',
  'pump.mp3',
  'compressor.mp3',
  'ventilation.mp3',
  'hydraulics.mp3',
  'servo.mp3',
]

// ============================================================

export class AudioEngine {
  ready = false

  // ---- core ----
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private white: AudioBuffer | null = null
  private brown: AudioBuffer | null = null
  private heartGain: GainNode | null = null
  private volume = 0.9
  private doppler = false

  // ---- ambience nodes (persistent) ----
  private windWhiteG: GainNode | null = null
  private windBrownG: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private windGain: GainNode | null = null
  private stormGain: GainNode | null = null
  private roomGain: GainNode | null = null
  private fanGain: GainNode | null = null

  // ---- cached applied targets (keeps per-frame calls cheap) ----
  private apPlanet: Planet | null = null
  private apWind = -1
  private apStorm = -1
  private apRoom = -1
  private apFan = -1
  private apBreath = -1
  private apBreathRate = -1

  // ---- desired state (survives being set before init) ----
  private env = { inside: false, planet: 'moon' as Planet, windIntensity: 0.3, storm: false }
  private fanLevel = 0.4
  private breathOn = false
  private breathEffort = 0.4
  private heartLevel = 0
  private alarmOn = false
  private roverOn = false
  private roverThrottle = 0
  // real recorded rover audio (NASA/JPL Perseverance drive — Sol 16)
  private roverBuf: AudioBuffer | null = null
  private roverBufTried = false
  private roverReal: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  // background music — user-supplied ambient track, looped quietly
  private bgmBuf: AudioBuffer | null = null
  private bgmTried = false
  private bgmOn = false
  private bgmVol = 0.16
  private bgmReal: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  // real recorded machinery/industrial one-shots (colony ambience)
  private machBufs: AudioBuffer[] = []
  private machTried = false
  private motorOn = false
  private motorThrottle = 0
  private burnOn = false

  // ---- scheduler (alarm beeps + heartbeat, single timer) ----
  private schedTimer: ReturnType<typeof setInterval> | null = null
  private nextAlarmAt = 0
  private alarmHi = false
  private nextHeartAt = 0

  // ---- loops & one-shot budget ----
  private loops = new Map<string, LoopNode>()
  private loopCounter = 0
  private shots = 0
  private readonly SHOT_CAP = 24

  // ---- listener cache (default placement for new positional loops) ----
  private listenerPos: AudioPosition = { x: 0, y: 1.6, z: 0 }
  private listenerFwd: AudioPosition = { x: 0, y: 0, z: -1 }

  // ================================================================
  // Lifecycle
  // ================================================================

  init(): void {
    if (this.ready) {
      this.resume()
      return
    }
    if (typeof window === 'undefined') return
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return

      const ctx = new Ctor()
      this.ctx = ctx

      // shared noise buffers (2s each)
      this.white = this.makeNoiseBuffer('white')
      this.brown = this.makeNoiseBuffer('brown')

      // master chain: gain -> compressor -> destination
      const master = ctx.createGain()
      master.gain.value = clamp01(this.volume)
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.knee.value = 18
      comp.ratio.value = 5
      comp.attack.value = 0.004
      comp.release.value = 0.24
      master.connect(comp)
      comp.connect(ctx.destination)
      this.master = master

      // heartbeat bus
      const hg = ctx.createGain()
      hg.gain.value = 0
      hg.connect(master)
      this.heartGain = hg

      this.buildAmbience()

      this.ready = true
      this.loadRoverSample()
      this.loadBgm()
      this.loadMachinery()
      this.apPlanet = null // force timbre application
      this.applyAmbience()
      if (this.heartGain) {
        this.heartGain.gain.setTargetAtTime(clamp01(this.heartLevel) * 0.35, ctx.currentTime, 0.3)
      }
      // re-apply any loop state requested before init
      if (this.burnOn) {
        this.burnOn = false
        this.landingBurn(true)
      }
      if (this.roverOn) {
        const th = this.roverThrottle
        this.roverOn = false
        this.setRoverEngine(true, th)
      }
      if (this.motorOn) {
        const th = this.motorThrottle
        this.motorOn = false
        this.setConstructionMotor(true, th)
      }

      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      if (!this.schedTimer) {
        this.schedTimer = setInterval(() => this.schedTick(), 200)
      }
    } catch {
      // never leave a half-built engine marked ready
      this.ctx = null
      this.master = null
      this.ready = false
    }
  }

  resume(): void {
    const ctx = this.ctx
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  }

  suspend(): void {
    const ctx = this.ctx
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
  }

  setMasterVolume(v: number): void {
    const vol = clamp01(v)
    this.volume = vol
    if (!this.ready || !this.master || !this.ctx) return
    try {
      this.master.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05)
    } catch {
      /* ignore */
    }
  }

  setDoppler(on: boolean): void {
    this.doppler = !!on
  }

  setListener(pos: AudioPosition, forward: { x: number; y: number; z: number }): void {
    const p = pos ?? { x: 0, y: 1.6, z: 0 }
    this.listenerPos = { x: num(p.x, 0), y: num(p.y, 1.6), z: num(p.z, 0) }
    const f = forward ?? { x: 0, y: 0, z: -1 }
    let fx = num(f.x, 0)
    let fy = num(f.y, 0)
    let fz = num(f.z, -1)
    const m = Math.max(Math.abs(fx), Math.abs(fy), Math.abs(fz))
    if (m < 1e-6) {
      fx = 0
      fy = 0
      fz = -1
    } else {
      fx /= m
      fy /= m
      fz /= m
    }
    this.listenerFwd = { x: fx, y: fy, z: fz }

    const ctx = this.ctx
    if (!ctx || !this.ready) return
    try {
      const L = ctx.listener
      const lp = this.listenerPos
      if (L.positionX) {
        L.positionX.value = lp.x
        L.positionY.value = lp.y
        L.positionZ.value = lp.z
      } else {
        L.setPosition(lp.x, lp.y, lp.z)
      }
      if (L.forwardX) {
        L.forwardX.value = fx
        L.forwardY.value = fy
        L.forwardZ.value = fz
      } else {
        L.setOrientation(fx, fy, fz, 0, 1, 0)
      }
    } catch {
      /* ignore */
    }
  }

  // ================================================================
  // Ambience
  // ================================================================

  setEnvironment(opts: {
    inside: boolean
    planet: Planet
    windIntensity: number
    storm: boolean
  }): void {
    if (!opts) return
    this.env = {
      inside: !!opts.inside,
      planet: opts.planet === 'mars' ? 'mars' : 'moon',
      windIntensity: clamp01(num(opts.windIntensity, 0.3)),
      storm: !!opts.storm,
    }
    if (!this.ready) return
    this.applyAmbience()
  }

  setFan(intensity: number): void {
    const lvl = clamp01(num(intensity, 0.4))
    if (Math.abs(lvl - this.fanLevel) < 0.01) return
    this.fanLevel = lvl
    if (!this.ready) return
    this.applyAmbience()
  }

  setAlarm(on: boolean): void {
    const next = !!on
    if (next === this.alarmOn) return
    this.alarmOn = next
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    if (next) {
      // immediate first beep, then the scheduler keeps the pattern going
      this.alarmBeep(ctx.currentTime + 0.08, this.alarmHi ? 880 : 660)
      this.alarmHi = !this.alarmHi
      this.nextAlarmAt = ctx.currentTime + 1.2
    }
  }

  setBreathing(on: boolean, effort = 0.4): void {
    const e = clamp01(num(effort, 0.4))
    if (on === this.breathOn && Math.abs(e - this.breathEffort) < 0.02) return
    this.breathOn = !!on
    this.breathEffort = e
    if (!this.ready) return
    this.applyBreathing()
  }

  setHeartbeat(intensity = 0): void {
    const lvl = clamp01(num(intensity, 0))
    const wasOff = this.heartLevel <= 0.02
    const changed = Math.abs(lvl - this.heartLevel) > 0.015
    this.heartLevel = lvl
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx || !this.heartGain) return
    if (changed) {
      try {
        this.heartGain.gain.setTargetAtTime(lvl * 0.35, ctx.currentTime, 0.4)
      } catch {
        /* ignore */
      }
    }
    if (wasOff && lvl > 0.02) this.nextHeartAt = 0
  }

  setRoverEngine(on: boolean, throttle = 0): void {
    const th = clamp01(num(throttle, 0))
    const changed = on !== this.roverOn || Math.abs(th - this.roverThrottle) >= 0.015
    this.roverOn = !!on
    this.roverThrottle = th
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx) return
    // prefer the real recorded rover audio once it has decoded
    if (!this.roverBuf && !this.roverBufTried) this.loadRoverSample()
    if (this.roverBuf) {
      if (!changed && (on ? this.roverReal !== null : this.roverReal === null)) return
      this.applyRoverReal(on, th)
      return
    }
    if (!on) {
      if (changed) this.killLoop('rover', 0.35)
      return
    }
    if (!changed && this.loops.has('rover')) return
    const loop = this.ensureLoop('rover', null, (out) => this.buildRover(out))
    if (!loop) return
    const t = ctx.currentTime
    const f = 74 + th * 92
    try {
      loop.params.freq.setTargetAtTime(f, t, 0.15)
      loop.params.sub.setTargetAtTime(f / 2, t, 0.15)
      loop.params.lp.setTargetAtTime(340 + th * 1200, t, 0.2)
      loop.params.eng.setTargetAtTime(0.045 + th * 0.1, t, 0.18)
      loop.params.wheel.setTargetAtTime(th > 0.02 ? th * 0.11 : 0.0001, t, 0.25)
      loop.ctrl.gain.setTargetAtTime(1, t, 0.2)
    } catch {
      /* ignore */
    }
  }

  // --------------------------------------------------------------
  // Real recorded rover audio (public NASA/JPL Perseverance drive
  // recording, Sol 16 — wheels + motors on Mars regolith).
  // --------------------------------------------------------------
  private loadRoverSample(): void {
    if (this.roverBufTried) return
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return
    const ctx = this.ctx
    if (!ctx) return
    this.roverBufTried = true
    fetch('/sounds/rover-drive.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.roverBuf = buf
        if (this.roverOn && this.ready) this.setRoverEngine(true, this.roverThrottle)
      })
      .catch(() => {
        // sample unavailable — procedural engine keeps running
      })
  }

  private applyRoverReal(on: boolean, th: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime
    if (this.loops.has('rover')) this.killLoop('rover', 0.2) // replace procedural fallback
    if (!on) {
      const r = this.roverReal
      this.roverReal = null
      if (r) {
        try {
          r.gain.gain.setTargetAtTime(0.0001, t, 0.12)
          r.src.stop(t + 0.6)
        } catch {
          /* ignore */
        }
      }
      return
    }
    let r = this.roverReal
    if (!r) {
      try {
        const src = ctx.createBufferSource()
        src.buffer = this.roverBuf!
        src.loop = true
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 1200
        filter.Q.value = 0.4
        const gain = ctx.createGain()
        gain.gain.value = 0.0001
        src.connect(filter)
        filter.connect(gain)
        gain.connect(master)
        const dur = this.roverBuf?.duration ?? 1
        src.start(0, Math.random() * Math.max(0.1, dur - 2))
        r = this.roverReal = { src, gain, filter }
      } catch {
        return
      }
    }
    try {
      r.gain.gain.setTargetAtTime(0.3 + th * 0.6, t, 0.15)
      r.filter.frequency.setTargetAtTime(1400 + th * 2600, t, 0.2)
      r.src.playbackRate.setTargetAtTime(0.82 + th * 0.4, t, 0.2)
    } catch {
      /* ignore */
    }
  }

  // --------------------------------------------------------------
  // Background music — user-supplied ambient track (Breath on the
  // Glass), looped quietly like an environmental sound bed.
  // --------------------------------------------------------------
  setBgm(on: boolean, volume = 0.16): void {
    this.bgmOn = !!on
    this.bgmVol = clamp01(num(volume, 0.16))
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx || !this.master) return
    if (!this.bgmBuf && !this.bgmTried) this.loadBgm()
    if (!on || !this.bgmBuf) return
    if (this.bgmReal) {
      try {
        this.bgmReal.gain.gain.setTargetAtTime(this.bgmVol, ctx.currentTime, 0.8)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      const src = ctx.createBufferSource()
      src.buffer = this.bgmBuf
      src.loop = true
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 9000
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      src.connect(lp)
      lp.connect(gain)
      gain.connect(this.master)
      src.start(0, Math.random() * Math.max(0.1, (this.bgmBuf.duration ?? 1) - 2))
      this.bgmReal = { src, gain }
      gain.gain.setTargetAtTime(this.bgmVol, ctx.currentTime, 1.2)
    } catch {
      /* ignore */
    }
  }

  private loadBgm(): void {
    if (this.bgmTried) return
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return
    const ctx = this.ctx
    if (!ctx) return
    this.bgmTried = true
    fetch('/sounds/bgm-breath-on-the-glass.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.bgmBuf = buf
        if (this.bgmOn && this.ready) this.setBgm(true, this.bgmVol)
      })
      .catch(() => {
        // sample unavailable — silent background
      })
  }

  // --------------------------------------------------------------
  // Colony machinery one-shots — real recorded industrial sounds
  // that play at random intervals around the player (generators,
  // pumps, compressors, servos working somewhere on the planet).
  // --------------------------------------------------------------
  playMachinery(volume = 0.12): void {
    const v = clamp01(num(volume, 0.12))
    const ctx = this.ctx
    if (!ctx || !this.master || this.machBufs.length === 0 || v <= 0.001) return
    if (this.shots >= this.SHOT_CAP) return
    try {
      const buf = this.machBufs[Math.floor(Math.random() * this.machBufs.length)]
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = 0.85 + Math.random() * 0.3
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 2400 + Math.random() * 3200
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      src.connect(lp)
      lp.connect(gain)
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null
      let tail: AudioNode = gain
      if (pan) {
        pan.pan.value = Math.random() * 1.6 - 0.8
        gain.connect(pan)
        pan.connect(this.master)
        tail = pan
      } else {
        gain.connect(this.master)
      }
      const dur = Math.min(buf.duration ?? 8, 6 + Math.random() * 9)
      const off = Math.random() * Math.max(0.1, (buf.duration ?? 1) - dur - 0.2)
      const t = ctx.currentTime + 0.03
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.setTargetAtTime(v, t, 1.1)
      gain.gain.setTargetAtTime(0.0001, t + Math.max(0.5, dur - 1.6), 0.55)
      src.start(t, off)
      src.stop(t + dur + 0.4)
      this.shots++
      src.onended = () => {
        this.shots--
        try { tail.disconnect() } catch { /* ignore */ }
      }
    } catch {
      /* ignore */
    }
  }

  machineryCount(): number {
    return this.machBufs.length
  }

  // debug/verification helper (also used by browser probes)
  bgmStatus(): { on: boolean; hasBuf: boolean; playing: boolean; vol: number } {
    return { on: this.bgmOn, hasBuf: !!this.bgmBuf, playing: !!this.bgmReal, vol: this.bgmVol }
  }

  roverRealActive(): boolean {
    return !!this.roverReal
  }

  private loadMachinery(): void {
    if (this.machTried) return
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return
    const ctx = this.ctx
    if (!ctx) return
    this.machTried = true
    for (const f of MACHINERY_CLIPS) {
      fetch(`/sounds/machinery/${f}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { this.machBufs.push(buf) })
        .catch(() => {
          // clip unavailable — skipped
        })
    }
  }

  setConstructionMotor(on: boolean, throttle = 0): void {
    const th = clamp01(num(throttle, 0))
    const changed = on !== this.motorOn || Math.abs(th - this.motorThrottle) >= 0.02
    this.motorOn = !!on
    this.motorThrottle = th
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx) return
    if (!on) {
      if (changed) this.killLoop('cmotor', 0.4)
      return
    }
    if (!changed && this.loops.has('cmotor')) return
    const loop = this.ensureLoop('cmotor', null, (out) => this.buildMotor(out))
    if (!loop) return
    const t = ctx.currentTime
    try {
      loop.params.servo.setTargetAtTime(520 + th * 780, t, 0.2)
      loop.params.main.setTargetAtTime(0.35 + th * 0.65, t, 0.25)
      loop.ctrl.gain.setTargetAtTime(1, t, 0.25)
    } catch {
      /* ignore */
    }
  }

  landingBurn(on: boolean): void {
    const next = !!on
    if (next === this.burnOn) return
    this.burnOn = next
    if (!this.ready) return
    const ctx = this.ctx
    if (!ctx) return
    if (!on) {
      this.killLoop('burn', 0.7)
      return
    }
    const loop = this.ensureLoop('burn', null, (out) => this.buildBurn(out))
    if (!loop) return
    try {
      loop.ctrl.gain.setTargetAtTime(0.55, ctx.currentTime, 0.45)
    } catch {
      /* ignore */
    }
  }

  // ================================================================
  // One-shots
  // ================================================================

  footstep(surface: SurfaceType, volume = 1): void {
    this.guard((ctx, master) => {
      const v = clamp01(volume)
      if (v <= 0.001) return
      const t = ctx.currentTime + 0.005
      if (surface === 'metal') {
        // clang-tap: sharp filtered tap + short metallic ring
        const src = this.noise(true, 'white')
        const bp = this.bq('bandpass', 1400 + Math.random() * 800, 1.1)
        const g = this.gn(0.0001)
        src.connect(bp)
        bp.connect(g)
        g.connect(master)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(0.22 * v, t + 0.004)
        g.gain.setTargetAtTime(0.0001, t + 0.006, 0.02)
        const o = this.osc('triangle', 900 + Math.random() * 600)
        const og = this.gn(0.0001)
        o.connect(og)
        og.connect(master)
        og.gain.setValueAtTime(0.0001, t + 0.003)
        og.gain.linearRampToValueAtTime(0.05 * v, t + 0.01)
        og.gain.setTargetAtTime(0.0001, t + 0.015, 0.055)
        src.start(t)
        o.start(t)
        this.trackShot([src, o], [src, bp, g, o, og], t + 0.5)
      } else {
        // regolith: muffled crunch — lowpass thump + gritty bandpass grains
        const src = this.noise(true, 'white')
        const lp = this.bq('lowpass', 380 + Math.random() * 200, 0.8)
        const g = this.gn(0.0001)
        const bp = this.bq('bandpass', 950 + Math.random() * 300, 0.8)
        const g2 = this.gn(0.0001)
        src.connect(lp)
        lp.connect(g)
        src.connect(bp)
        bp.connect(g2)
        g.connect(master)
        g2.connect(master)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(0.26 * v, t + 0.008)
        g.gain.setTargetAtTime(0.0001, t + 0.012, 0.045)
        g2.gain.setValueAtTime(0.0001, t)
        g2.gain.linearRampToValueAtTime(0.09 * v, t + 0.01)
        g2.gain.setTargetAtTime(0.0001, t + 0.015, 0.03)
        // second crunch grain (boot flex / grit shift)
        g2.gain.setValueAtTime(0.06 * v, t + 0.07)
        g2.gain.setTargetAtTime(0.0001, t + 0.075, 0.025)
        src.start(t)
        this.trackShot([src], [src, lp, g, bp, g2], t + 0.45)
      }
    })
  }

  interactBlip(): void {
    this.guard((ctx) => {
      this.tone(ctx.currentTime + 0.01, 1150, 0.09, 0.12, 'sine', 1560)
    })
  }

  denyBlip(): void {
    this.guard((ctx) => {
      const t = ctx.currentTime + 0.01
      this.tone(t, 320, 0.08, 0.11, 'triangle', 262)
      this.tone(t + 0.11, 262, 0.1, 0.1, 'triangle', 215)
    })
  }

  toolWrench(duration = 0.9): void {
    this.guard((ctx, master) => {
      const dur = Math.max(0.3, Math.min(4, num(duration, 0.9)))
      const t0 = ctx.currentTime + 0.02
      const n = Math.max(4, Math.min(16, Math.round(dur / 0.08)))
      // ratchet clicks as spikes on one shared noise source
      const src = this.noise(true, 'white')
      const hp = this.bq('highpass', 1400, 0.8)
      const lp = this.bq('lowpass', 6500, 0.7)
      const g = this.gn(0.0001)
      src.connect(hp)
      hp.connect(lp)
      lp.connect(g)
      g.connect(master)
      g.gain.setValueAtTime(0.0001, t0)
      let t = t0
      for (let i = 0; i < n; i++) {
        g.gain.setValueAtTime(0.13 + Math.random() * 0.1, t)
        g.gain.setTargetAtTime(0.0001, t + 0.008, 0.014)
        t += 0.05 + Math.random() * 0.1
      }
      // final stronger clack
      const tf = Math.max(t, t0 + dur)
      g.gain.setValueAtTime(0.34, tf)
      g.gain.setTargetAtTime(0.0001, tf + 0.01, 0.03)
      src.start(t0)
      this.trackShot([src], [src, hp, lp, g], tf + 0.3)
      this.thumpTick(tf, 0.18)
    })
  }

  toolWeld(duration = 1.5): void {
    this.guard((ctx, master) => {
      const dur = Math.max(0.4, Math.min(6, num(duration, 1.5)))
      const t0 = ctx.currentTime + 0.02
      const end = t0 + dur
      // sizzling arc: highpassed white noise, sputtering envelope
      const src = this.noise(true, 'white')
      const hp = this.bq('highpass', 3000, 0.8)
      const bp = this.bq('bandpass', 6200, 1.2)
      const g = this.gn(0.0001)
      src.connect(hp)
      hp.connect(bp)
      bp.connect(g)
      g.connect(master)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.28, t0 + 0.04)
      let t = t0 + 0.12
      while (t < end - 0.06) {
        g.gain.setTargetAtTime(0.1 + Math.random() * 0.24, t, 0.03)
        t += 0.05 + Math.random() * 0.12
      }
      g.gain.setTargetAtTime(0.0001, end - 0.05, 0.05)
      // random arc crackles tapped off the same source
      const cg = this.gn(0.0001)
      bp.connect(cg)
      cg.connect(master)
      cg.gain.setValueAtTime(0.0001, t0)
      let ct = t0 + 0.06
      while (ct < end - 0.05) {
        cg.gain.setValueAtTime(0.12 + Math.random() * 0.2, ct)
        cg.gain.setTargetAtTime(0.0001, ct + 0.008, 0.015)
        ct += 0.06 + Math.random() * 0.18
      }
      // faint electrical hum
      const hum = this.osc('sawtooth', 118)
      const hlp = this.bq('lowpass', 240, 0.7)
      const hg = this.gn(0.0001)
      hum.connect(hlp)
      hlp.connect(hg)
      hg.connect(master)
      hg.gain.setValueAtTime(0.0001, t0)
      hg.gain.linearRampToValueAtTime(0.055, t0 + 0.08)
      hg.gain.setTargetAtTime(0.0001, end - 0.08, 0.08)
      src.start(t0)
      hum.start(t0)
      this.trackShot([src, hum], [src, hp, bp, g, cg, hum, hlp, hg], end + 0.4)
    })
  }

  airlock(): void {
    this.guard((ctx, master) => {
      const t0 = ctx.currentTime + 0.02
      // pressure equalization: white noise burst with a lowpass sweep down
      const src = this.noise(true, 'white')
      const hp = this.bq('highpass', 320, 0.7)
      const lp = this.bq('lowpass', 7200, 0.5)
      const g = this.gn(0.0001)
      src.connect(hp)
      hp.connect(lp)
      lp.connect(g)
      g.connect(master)
      // valve snap
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.2, t0 + 0.008)
      g.gain.setTargetAtTime(0.0001, t0 + 0.01, 0.02)
      // hiss
      const t1 = t0 + 0.14
      g.gain.setValueAtTime(0.0001, t1)
      g.gain.linearRampToValueAtTime(0.4, t1 + 0.06)
      g.gain.setValueAtTime(0.4, t1 + 0.5)
      g.gain.setTargetAtTime(0.0001, t1 + 0.55, 0.3)
      lp.frequency.setValueAtTime(7200, t1)
      lp.frequency.setTargetAtTime(800, t1 + 0.2, 0.45)
      // soft end clunk
      const t2 = t1 + 1.05
      const o = this.osc('sine', 84)
      const og = this.gn(0.0001)
      o.connect(og)
      og.connect(master)
      o.frequency.setValueAtTime(84, t2)
      o.frequency.exponentialRampToValueAtTime(46, t2 + 0.15)
      og.gain.setValueAtTime(0.0001, t2)
      og.gain.linearRampToValueAtTime(0.34, t2 + 0.014)
      og.gain.setTargetAtTime(0.0001, t2 + 0.03, 0.06)
      src.start(t0)
      o.start(t2)
      this.trackShot([src, o], [src, hp, lp, g, o, og], t2 + 0.6)
      this.click(t2 + 0.02, 1200, 0.12)
    })
  }

  doorServo(): void {
    this.guard((ctx, master) => {
      const t0 = ctx.currentTime + 0.02
      const o = this.osc('sawtooth', 138)
      const lp = this.bq('lowpass', 560, 1.1)
      const g = this.gn(0.0001)
      o.connect(lp)
      lp.connect(g)
      g.connect(master)
      const wob = this.osc('sine', 7.5)
      const wd = this.gn(5.5)
      wob.connect(wd)
      wd.connect(o.frequency)
      o.frequency.setValueAtTime(138, t0)
      o.frequency.linearRampToValueAtTime(112, t0 + 0.5)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.14, t0 + 0.06)
      g.gain.setValueAtTime(0.14, t0 + 0.42)
      g.gain.setTargetAtTime(0.0001, t0 + 0.44, 0.06)
      o.start(t0)
      wob.start(t0)
      this.trackShot([o, wob], [o, wob, lp, g, wd], t0 + 0.9)
      this.click(t0 + 0.02, 1800, 0.07)
      this.click(t0 + 0.56, 2400, 0.1)
    })
  }

  radioBlip(): void {
    this.guard((ctx) => {
      this.click(ctx.currentTime + 0.015, 1900, 0.16)
    })
  }

  radioVoice(duration = 1.8): void {
    this.guard((ctx, master) => {
      const dur = Math.max(0.4, Math.min(4, num(duration, 1.8)))
      const t0 = ctx.currentTime + 0.05
      const end = t0 + dur
      // carrier: bandpassed noise with slow filter wobble
      const src = this.noise(true, 'white')
      const bp = this.bq('bandpass', 1750, 1.7)
      const wob = this.osc('sine', 0.5)
      const wd = this.gn(260)
      wob.connect(wd)
      wd.connect(bp.frequency)
      // syllable envelope on this gain (gates both noise + babble)
      const sg = this.gn(0.0001)
      src.connect(bp)
      bp.connect(sg)
      // voiced babble: sawtooth with random pitch steps per syllable
      const saw = this.osc('sawtooth', 120)
      const sbp = this.bq('bandpass', 1250, 2.2)
      const sv = this.gn(0.16)
      saw.connect(sbp)
      sbp.connect(sv)
      sv.connect(sg)
      const vib = this.osc('sine', 5.2)
      const vd = this.gn(3.5)
      vib.connect(vd)
      vd.connect(saw.frequency)
      const out = this.gn(0.5)
      sg.connect(out)
      out.connect(master)
      // schedule unintelligible syllables
      sg.gain.setValueAtTime(0.0001, t0)
      let t = t0 + 0.03
      while (t < end - 0.08) {
        const on = 0.05 + Math.random() * 0.16
        const off = 0.02 + Math.random() * 0.11
        sg.gain.setTargetAtTime(0.45 + Math.random() * 0.55, t, Math.min(0.03, on * 0.4))
        sg.gain.setTargetAtTime(0.04 + Math.random() * 0.08, t + on, 0.02)
        saw.frequency.setValueAtTime(85 + Math.random() * 95, t)
        t += on + off
      }
      sg.gain.setTargetAtTime(0.0001, end - 0.05, 0.03)
      // squelch tails
      this.click(t0 - 0.01, 1900, 0.14)
      this.click(end + 0.02, 2100, 0.12)
      src.start(t0)
      wob.start(t0)
      saw.start(t0)
      vib.start(t0)
      this.trackShot(
        [src, wob, saw, vib],
        [src, bp, wob, wd, sg, saw, sbp, sv, vib, vd, out],
        end + 0.25
      )
    })
  }

  alarmPing(): void {
    this.guard((ctx) => {
      const t = ctx.currentTime + 0.01
      this.tone(t, 830, 0.32, 0.14, 'sine')
      this.tone(t, 1660, 0.28, 0.035, 'sine')
    })
  }

  thud(intensity = 1): void {
    this.guard((ctx, master) => {
      const v = clamp01(intensity)
      if (v <= 0.001) return
      const t0 = ctx.currentTime + 0.01
      // sub-bass body
      const o = this.osc('sine', 58)
      const g = this.gn(0.0001)
      o.connect(g)
      g.connect(master)
      o.frequency.setValueAtTime(58, t0)
      o.frequency.exponentialRampToValueAtTime(27, t0 + 0.3)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.55 * v, t0 + 0.012)
      g.gain.setTargetAtTime(0.0001, t0 + 0.02, 0.09)
      // dull impact noise
      const src = this.noise(true, 'brown')
      const lp = this.bq('lowpass', 130, 0.6)
      const ng = this.gn(0.0001)
      src.connect(lp)
      lp.connect(ng)
      ng.connect(master)
      ng.gain.setValueAtTime(0.0001, t0)
      ng.gain.linearRampToValueAtTime(0.4 * v, t0 + 0.015)
      ng.gain.setTargetAtTime(0.0001, t0 + 0.03, 0.12)
      o.start(t0)
      src.start(t0)
      this.trackShot([o, src], [o, g, src, lp, ng], t0 + 0.9)
    })
  }

  meteorBoom(): void {
    this.guard((ctx, master) => {
      const t0 = ctx.currentTime + 0.02
      // distant muffled boom — lowpassed brown noise, slow swell
      const src = this.noise(true, 'brown')
      const lp = this.bq('lowpass', 170, 0.5)
      const g = this.gn(0.0001)
      src.connect(lp)
      lp.connect(g)
      g.connect(master)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.12)
      g.gain.setTargetAtTime(0.0001, t0 + 0.18, 0.55)
      // deep sub tail
      const sub = this.osc('sine', 42)
      const sg = this.gn(0.0001)
      sub.connect(sg)
      sg.connect(master)
      sub.frequency.setValueAtTime(42, t0)
      sub.frequency.exponentialRampToValueAtTime(28, t0 + 1.1)
      sg.gain.setValueAtTime(0.0001, t0)
      sg.gain.linearRampToValueAtTime(0.3, t0 + 0.07)
      sg.gain.setTargetAtTime(0.0001, t0 + 0.15, 0.35)
      // sparse debris crackle
      const cr = this.noise(true, 'white')
      const cbp = this.bq('bandpass', 3100, 0.9)
      const cg = this.gn(0.0001)
      cr.connect(cbp)
      cbp.connect(cg)
      cg.connect(master)
      cg.gain.setValueAtTime(0.0001, t0)
      let ct = t0 + 0.35
      for (let i = 0; i < 11; i++) {
        cg.gain.setValueAtTime(0.015 + Math.random() * 0.05, ct)
        cg.gain.setTargetAtTime(0.0001, ct + 0.012, 0.02)
        ct += 0.07 + Math.random() * 0.22
      }
      src.start(t0)
      sub.start(t0)
      cr.start(t0)
      this.trackShot([src, sub, cr], [src, lp, g, sub, sg, cr, cbp, cg], t0 + 3)
    })
  }

  leakHiss(): string {
    if (!this.ready || !this.ctx || !this.master) return ''
    const id = `leak-${++this.loopCounter}`
    try {
      const loop = this.ensureLoop(id, this.listenerPos, (out) => {
        const ctx = this.ctx
        if (!ctx) return null
        const src = this.noise(true, 'white')
        const hp = this.bq('highpass', 1500, 0.7)
        const bp = this.bq('bandpass', 3200, 1.1)
        const flut = this.osc('sine', 6.5 + Math.random() * 4)
        const fd = this.gn(420)
        flut.connect(fd)
        fd.connect(bp.frequency)
        const g = this.gn(0.5)
        src.connect(hp)
        hp.connect(bp)
        bp.connect(g)
        g.connect(out)
        src.start()
        flut.start()
        return {
          sources: [src, flut],
          cleanup: [src, hp, bp, g, flut, fd],
          params: {},
        }
      })
      if (!loop || !this.ctx) return ''
      loop.ctrl.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.25)
      return id
    } catch {
      return ''
    }
  }

  touchdown(): void {
    this.guard((ctx, master) => {
      const t0 = ctx.currentTime + 0.02
      // dust thump
      const src = this.noise(true, 'brown')
      const lp = this.bq('lowpass', 95, 0.7)
      const g = this.gn(0.0001)
      src.connect(lp)
      lp.connect(g)
      g.connect(master)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.02)
      g.gain.setTargetAtTime(0.0001, t0 + 0.04, 0.13)
      // dust puff
      const dust = this.noise(true, 'white')
      const bp = this.bq('bandpass', 850, 0.6)
      const dg = this.gn(0.0001)
      dust.connect(bp)
      bp.connect(dg)
      dg.connect(master)
      dg.gain.setValueAtTime(0.0001, t0)
      dg.gain.linearRampToValueAtTime(0.16, t0 + 0.03)
      dg.gain.setTargetAtTime(0.0001, t0 + 0.06, 0.28)
      // settling grit ticks
      const grit = this.noise(true, 'white')
      const gbp = this.bq('bandpass', 1500, 1.1)
      const gg = this.gn(0.0001)
      grit.connect(gbp)
      gbp.connect(gg)
      gg.connect(master)
      gg.gain.setValueAtTime(0.0001, t0)
      let ct = t0 + 0.15
      for (let i = 0; i < 7; i++) {
        gg.gain.setValueAtTime(0.055 * (1 - i * 0.11), ct)
        gg.gain.setTargetAtTime(0.0001, ct + 0.01, 0.02)
        ct += 0.1 + Math.random() * 0.18
      }
      src.start(t0)
      dust.start(t0)
      grit.start(t0)
      this.trackShot([src, dust, grit], [src, lp, g, dust, bp, dg, grit, gbp, gg], t0 + 1.8)
    })
  }

  success(): void {
    this.guard((ctx) => {
      const t = ctx.currentTime + 0.02
      this.tone(t, 660, 0.16, 0.14, 'sine')
      this.tone(t + 0.15, 880, 0.3, 0.14, 'sine')
    })
  }

  constructorCue(stage: number): void {
    if (stage === 2) {
      // weld / assembly
      this.toolWeld(1.5)
      this.guard((ctx) => {
        const t = ctx.currentTime + 0.4
        this.tone(t, 1250, 0.12, 0.05, 'triangle')
        this.tone(t + 0.55, 940, 0.12, 0.045, 'triangle')
      })
      return
    }
    if (stage === 3) {
      // complete — soft ascending three-tone confirm
      this.guard((ctx) => {
        const t = ctx.currentTime + 0.02
        this.tone(t, 523, 0.18, 0.12, 'sine')
        this.tone(t + 0.17, 659, 0.18, 0.12, 'sine')
        this.tone(t + 0.34, 784, 0.42, 0.14, 'sine')
        this.tone(t + 0.34, 392, 0.5, 0.05, 'triangle')
      })
      return
    }
    if (stage === 0) {
      // rover arrives — diesel-less electric approach, brake hiss, clunk
      this.guard((ctx, master) => {
        const t0 = ctx.currentTime + 0.05
        const saw = this.osc('sawtooth', 52)
        const lp = this.bq('lowpass', 260, 0.8)
        const g = this.gn(0.0001)
        saw.connect(lp)
        lp.connect(g)
        g.connect(master)
        saw.frequency.setValueAtTime(52, t0)
        saw.frequency.linearRampToValueAtTime(96, t0 + 1.1)
        saw.frequency.linearRampToValueAtTime(40, t0 + 1.7)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.linearRampToValueAtTime(0.2, t0 + 0.9)
        g.gain.setTargetAtTime(0.0001, t0 + 1.3, 0.18)
        // rumble bed
        const rn = this.noise(true, 'brown')
        const rlp = this.bq('lowpass', 140, 0.7)
        const rg = this.gn(0.0001)
        rn.connect(rlp)
        rlp.connect(rg)
        rg.connect(master)
        rg.gain.setValueAtTime(0.0001, t0)
        rg.gain.linearRampToValueAtTime(0.17, t0 + 0.8)
        rg.gain.setTargetAtTime(0.0001, t0 + 1.2, 0.3)
        // brake hiss
        const hn = this.noise(true, 'white')
        const hbp = this.bq('bandpass', 2100, 0.9)
        const hg = this.gn(0.0001)
        hn.connect(hbp)
        hbp.connect(hg)
        hg.connect(master)
        hg.gain.setValueAtTime(0.0001, t0 + 1.45)
        hg.gain.linearRampToValueAtTime(0.13, t0 + 1.52)
        hg.gain.setTargetAtTime(0.0001, t0 + 1.56, 0.06)
        // final clunk
        const cl = this.osc('sine', 66)
        const cg = this.gn(0.0001)
        cl.connect(cg)
        cg.connect(master)
        cl.frequency.setValueAtTime(66, t0 + 1.75)
        cl.frequency.exponentialRampToValueAtTime(38, t0 + 1.9)
        cg.gain.setValueAtTime(0.0001, t0 + 1.75)
        cg.gain.linearRampToValueAtTime(0.3, t0 + 1.76)
        cg.gain.setTargetAtTime(0.0001, t0 + 1.78, 0.07)
        saw.start(t0)
        rn.start(t0)
        hn.start(t0)
        cl.start(t0 + 1.7)
        this.trackShot([saw, rn, hn, cl], [saw, lp, g, rn, rlp, rg, hn, hbp, hg, cl, cg], t0 + 2.3)
      })
      return
    }
    if (stage === 1) {
      // crane operate — servo steps + hydraulic thunk
      this.guard((ctx, master) => {
        const t0 = ctx.currentTime + 0.05
        const sq = this.osc('square', 760)
        const bp = this.bq('bandpass', 950, 6)
        const g = this.gn(0.0001)
        sq.connect(bp)
        bp.connect(g)
        g.connect(master)
        sq.frequency.setValueAtTime(760, t0)
        sq.frequency.setValueAtTime(920, t0 + 0.45)
        sq.frequency.setValueAtTime(690, t0 + 0.95)
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.linearRampToValueAtTime(0.08, t0 + 0.08)
        g.gain.setValueAtTime(0.08, t0 + 1.0)
        g.gain.setTargetAtTime(0.0001, t0 + 1.02, 0.1)
        // hydraulic thunk at the end of the move
        const t1 = t0 + 1.15
        const o = this.osc('sine', 58)
        const og = this.gn(0.0001)
        o.connect(og)
        og.connect(master)
        o.frequency.setValueAtTime(58, t1)
        o.frequency.exponentialRampToValueAtTime(36, t1 + 0.16)
        og.gain.setValueAtTime(0.0001, t1)
        og.gain.linearRampToValueAtTime(0.3, t1 + 0.014)
        og.gain.setTargetAtTime(0.0001, t1 + 0.03, 0.07)
        const th = this.noise(true, 'brown')
        const tlp = this.bq('lowpass', 110, 0.7)
        const tg = this.gn(0.0001)
        th.connect(tlp)
        tlp.connect(tg)
        tg.connect(master)
        tg.gain.setValueAtTime(0.0001, t1)
        tg.gain.linearRampToValueAtTime(0.22, t1 + 0.02)
        tg.gain.setTargetAtTime(0.0001, t1 + 0.04, 0.1)
        sq.start(t0)
        o.start(t1)
        th.start(t1)
        this.trackShot([sq, o, th], [sq, bp, g, o, og, th, tlp, tg], t1 + 0.7)
      })
    }
  }

  // ================================================================
  // Generic loop control
  // ================================================================

  stopLoop(handle: string): void {
    if (!handle) return
    this.killLoop(handle, 0.15)
  }

  setLoopPosition(handle: string, pos: AudioPosition): void {
    if (!handle || !pos) return
    const loop = this.loops.get(handle)
    if (!loop || !loop.panner || !this.ready) return
    this.setNodePos(loop.panner, {
      x: num(pos.x, 0),
      y: num(pos.y, 0),
      z: num(pos.z, 0),
    })
  }

  // ================================================================
  // Internals
  // ================================================================

  private makeNoiseBuffer(kind: 'white' | 'brown'): AudioBuffer {
    const ctx = this.ctx
    if (!ctx) throw new Error('no context')
    const len = Math.floor(ctx.sampleRate * 2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } else {
      // brown noise: integrated white, normalized
      let last = 0
      let peak = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = (last + 0.02 * w) / 1.02
        d[i] = last
        const a = Math.abs(last)
        if (a > peak) peak = a
      }
      if (peak > 1e-6) {
        const k = 0.9 / peak
        for (let i = 0; i < len; i++) d[i] *= k
      }
    }
    return buf
  }

  private buildAmbience(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return

    // ---- outside wind (crossfaded, planet-flavored) ----
    const wWhite = this.noise(true, 'white')
    const wBrown = this.noise(true, 'brown')
    this.windWhiteG = this.gn(0.9)
    this.windBrownG = this.gn(0.1)
    const windHP = this.bq('highpass', 60, 0.7)
    this.windFilter = this.bq('bandpass', 1050, 0.55) // moon flavor; mars set in applyAmbience
    const gustG = this.gn(0.62)
    this.windGain = this.gn(0)
    wWhite.connect(this.windWhiteG)
    wBrown.connect(this.windBrownG)
    this.windWhiteG.connect(windHP)
    this.windBrownG.connect(windHP)
    windHP.connect(this.windFilter)
    this.windFilter.connect(gustG)
    gustG.connect(this.windGain)
    this.windGain.connect(master)
    // slow organic gusting (two LFOs) + filter movement
    const gustLfo = this.osc('sine', 0.06)
    const gustDepth = this.gn(0.38)
    gustLfo.connect(gustDepth)
    gustDepth.connect(gustG.gain)
    const gustLfo2 = this.osc('sine', 0.17)
    const gustDepth2 = this.gn(0.1)
    gustLfo2.connect(gustDepth2)
    gustDepth2.connect(gustG.gain)
    const filtDepth = this.gn(170)
    gustLfo.connect(filtDepth)
    filtDepth.connect(this.windFilter.frequency)
    wWhite.start()
    wBrown.start()
    gustLfo.start()
    gustLfo2.start()

    // ---- storm layer (dust storm / solar storm rattle) ----
    const sSrc = this.noise(true, 'white')
    const sBP = this.bq('bandpass', 640, 0.7)
    const sGust = this.gn(0.55)
    this.stormGain = this.gn(0)
    sSrc.connect(sBP)
    sBP.connect(sGust)
    sGust.connect(this.stormGain)
    this.stormGain.connect(master)
    const sLfo = this.osc('sine', 0.23)
    const sDepth = this.gn(0.45)
    sLfo.connect(sDepth)
    sDepth.connect(sGust.gain)
    sSrc.start()
    sLfo.start()

    // ---- interior room tone: very low hum + faint air ----
    const hum1 = this.osc('sine', 52)
    const hum2 = this.osc('sine', 104)
    const h1 = this.gn(0.6)
    const h2 = this.gn(0.22)
    const humG = this.gn(0.05)
    hum1.connect(h1)
    hum2.connect(h2)
    h1.connect(humG)
    h2.connect(humG)
    const rAir = this.noise(true, 'white')
    const rLP = this.bq('lowpass', 340, 0.6)
    const rAirG = this.gn(0.055)
    rAir.connect(rLP)
    rLP.connect(rAirG)
    this.roomGain = this.gn(0)
    humG.connect(this.roomGain)
    rAirG.connect(this.roomGain)
    this.roomGain.connect(master)
    hum1.start()
    hum2.start()
    rAir.start()

    // ---- interior life-support fan (setFan controls level) ----
    const fSrc = this.noise(true, 'white')
    const fBP = this.bq('bandpass', 270, 1.3)
    const fG = this.gn(0.5)
    this.fanGain = this.gn(0)
    fSrc.connect(fBP)
    fBP.connect(fG)
    fG.connect(this.fanGain)
    this.fanGain.connect(master)
    const fLfo = this.osc('sine', 3.1)
    const fDepth = this.gn(0.12)
    fLfo.connect(fDepth)
    fDepth.connect(fG.gain)
    const fBlade = this.osc('sine', 14)
    const fBladeD = this.gn(24)
    fBlade.connect(fBladeD)
    fBladeD.connect(fBP.frequency)
    fSrc.start()
    fLfo.start()
    fBlade.start()
  }

  private applyAmbience(): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    const t = ctx.currentTime
    const { inside, planet, windIntensity, storm } = this.env
    const wi = windIntensity

    // planet timbre (rare change)
    if (this.windFilter && this.windWhiteG && this.windBrownG && this.apPlanet !== planet) {
      this.apPlanet = planet
      try {
        if (planet === 'moon') {
          // thin / airy
          this.windFilter.type = 'bandpass'
          this.windFilter.frequency.setTargetAtTime(1050, t, 0.4)
          this.windFilter.Q.setTargetAtTime(0.55, t, 0.4)
          this.windWhiteG.gain.setTargetAtTime(0.9, t, 0.5)
          this.windBrownG.gain.setTargetAtTime(0.1, t, 0.5)
        } else {
          // lower / rumblier
          this.windFilter.type = 'lowpass'
          this.windFilter.frequency.setTargetAtTime(470, t, 0.4)
          this.windFilter.Q.setTargetAtTime(0.9, t, 0.4)
          this.windWhiteG.gain.setTargetAtTime(0.3, t, 0.5)
          this.windBrownG.gain.setTargetAtTime(0.65, t, 0.5)
        }
      } catch {
        /* ignore */
      }
    }

    // wind level (muffled + reduced when inside; storms raise it a lot)
    let wind = inside ? 0.05 + wi * 0.03 : 0.05 + wi * 0.2
    if (planet === 'moon') wind *= 0.85
    if (storm) wind = inside ? Math.max(wind, 0.15) : Math.min(0.55, wind * 2.3 + 0.13)
    if (this.windGain && Math.abs(wind - this.apWind) > 0.003) {
      this.apWind = wind
      try {
        this.windGain.gain.setTargetAtTime(wind, t, inside ? 0.4 : 0.9)
      } catch {
        /* ignore */
      }
    }

    // storm rattle layer
    const stormLvl = storm ? (inside ? 0.13 : 0.32 + wi * 0.2) : 0
    if (this.stormGain && Math.abs(stormLvl - this.apStorm) > 0.003) {
      this.apStorm = stormLvl
      try {
        this.stormGain.gain.setTargetAtTime(stormLvl, t, 1.1)
      } catch {
        /* ignore */
      }
    }

    // room tone crossfade
    const room = inside ? 1 : 0
    if (this.roomGain && room !== this.apRoom) {
      this.apRoom = room
      try {
        this.roomGain.gain.setTargetAtTime(room, t, 0.5)
      } catch {
        /* ignore */
      }
    }

    // fan crossfade (only audible inside)
    const fan = inside ? clamp01(this.fanLevel) * 0.5 : 0
    if (this.fanGain && Math.abs(fan - this.apFan) > 0.003) {
      this.apFan = fan
      try {
        this.fanGain.gain.setTargetAtTime(fan, t, 0.45)
      } catch {
        /* ignore */
      }
    }

    // breathing is automatically silenced inside the suit-off interior
    this.applyBreathing()
  }

  private applyBreathing(): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    const t = ctx.currentTime
    const active = this.breathOn && !this.env.inside
    const effort = clamp01(this.breathEffort)
    if (active) {
      const loop = this.ensureLoop('breath', null, (out) => this.buildBreath(out))
      if (!loop) return
      const vol = 0.3 + effort * 0.55
      const rate = 0.24 + effort * 0.26 // ~0.25Hz at rest -> ~0.5Hz under effort
      if (Math.abs(vol - this.apBreath) > 0.01) {
        this.apBreath = vol
        try {
          loop.ctrl.gain.setTargetAtTime(vol, t, 0.5)
        } catch {
          /* ignore */
        }
      }
      if (Math.abs(rate - this.apBreathRate) > 0.01) {
        this.apBreathRate = rate
        try {
          loop.params.rate.setTargetAtTime(rate, t, 0.6)
        } catch {
          /* ignore */
        }
      }
    } else {
      this.apBreath = -1
      this.apBreathRate = -1
      if (this.loops.has('breath')) this.killLoop('breath', 0.6)
    }
  }

  // ---------- loop builders ----------

  private buildBreath(out: GainNode): LoopParts | null {
    const ctx = this.ctx
    if (!ctx) return null
    const src = this.noise(true, 'white')
    const bp = this.bq('bandpass', 430, 1.0)
    const env = this.gn(0)
    src.connect(bp)
    bp.connect(env)
    env.connect(out)
    // rectified LFO gives alternating inhale/exhale bursts
    const lfo = this.osc('sine', 0.25)
    const shaper = ctx.createWaveShaper()
    const n = 129
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.abs(x)
    }
    shaper.curve = curve
    const depth = this.gn(0.55)
    lfo.connect(shaper)
    shaper.connect(depth)
    depth.connect(env.gain)
    // inhale brighter / exhale darker
    const fd = this.gn(115)
    lfo.connect(fd)
    fd.connect(bp.frequency)
    src.start()
    lfo.start()
    return {
      sources: [src, lfo],
      cleanup: [src, bp, env, lfo, shaper, depth, fd],
      params: { rate: lfo.frequency },
    }
  }

  private buildRover(out: GainNode): LoopParts | null {
    const ctx = this.ctx
    if (!ctx) return null
    // electric motor whine
    const saw = this.osc('sawtooth', 90)
    const sub = this.osc('sine', 45)
    const lp = this.bq('lowpass', 420, 0.8)
    const eg = this.gn(0.1)
    const sg = this.gn(0.12)
    const vib = this.osc('sine', 6.2)
    const vd = this.gn(2.6)
    vib.connect(vd)
    vd.connect(saw.frequency)
    vd.connect(sub.frequency)
    saw.connect(lp)
    lp.connect(eg)
    sub.connect(sg)
    // wheel / traction noise
    const wsrc = this.noise(true, 'brown')
    const wbp = this.bq('bandpass', 230, 0.9)
    const wg = this.gn(0.0001)
    wsrc.connect(wbp)
    wbp.connect(wg)
    eg.connect(out)
    sg.connect(out)
    wg.connect(out)
    saw.start()
    sub.start()
    vib.start()
    wsrc.start()
    return {
      sources: [saw, sub, vib, wsrc],
      cleanup: [saw, sub, vib, vd, lp, eg, sg, wsrc, wbp, wg],
      params: { freq: saw.frequency, sub: sub.frequency, lp: lp.frequency, eng: eg.gain, wheel: wg.gain },
    }
  }

  private buildMotor(out: GainNode): LoopParts | null {
    const ctx = this.ctx
    if (!ctx) return null
    // hydraulic pump
    const pump = this.osc('sawtooth', 44)
    const plp = this.bq('lowpass', 180, 0.8)
    const pg = this.gn(0.5)
    // hydraulic fluid rush with slow wobble
    const hyd = this.noise(true, 'brown')
    const hlp = this.bq('lowpass', 150, 0.7)
    const hg = this.gn(0.4)
    const wob = this.osc('sine', 3.6)
    const wd = this.gn(0.12)
    wob.connect(wd)
    wd.connect(hg.gain)
    // servo whine
    const servo = this.osc('square', 700)
    const sbp = this.bq('bandpass', 950, 5)
    const sg = this.gn(0.06)
    const mix = this.gn(0.5)
    pump.connect(plp)
    plp.connect(pg)
    pg.connect(mix)
    hyd.connect(hlp)
    hlp.connect(hg)
    hg.connect(mix)
    servo.connect(sbp)
    sbp.connect(sg)
    sg.connect(mix)
    mix.connect(out)
    pump.start()
    hyd.start()
    wob.start()
    servo.start()
    return {
      sources: [pump, hyd, wob, servo],
      cleanup: [pump, plp, pg, hyd, hlp, hg, wob, wd, servo, sbp, sg, mix],
      params: { servo: servo.frequency, main: mix.gain },
    }
  }

  private buildBurn(out: GainNode): LoopParts | null {
    const ctx = this.ctx
    if (!ctx) return null
    // low rumble with turbulence
    const rum = this.noise(true, 'brown')
    const rlp = this.bq('lowpass', 115, 0.6)
    const rg = this.gn(0.8)
    const rlfo = this.osc('sine', 8.5)
    const rd = this.gn(0.22)
    rlfo.connect(rd)
    rd.connect(rg.gain)
    const rfl = this.osc('sine', 1.7)
    const rfd = this.gn(32)
    rfl.connect(rfd)
    rfd.connect(rlp.frequency)
    // vapor hiss
    const hiss = this.noise(true, 'white')
    const hhp = this.bq('highpass', 2100, 0.7)
    const hg = this.gn(0.4)
    const hlfo = this.osc('sine', 12.7)
    const hd = this.gn(0.12)
    hlfo.connect(hd)
    hd.connect(hg.gain)
    rum.connect(rlp)
    rlp.connect(rg)
    hiss.connect(hhp)
    hhp.connect(hg)
    rg.connect(out)
    hg.connect(out)
    rum.start()
    hiss.start()
    rlfo.start()
    rfl.start()
    hlfo.start()
    return {
      sources: [rum, hiss, rlfo, rfl, hlfo],
      cleanup: [rum, rlp, rg, rlfo, rd, rfl, rfd, hiss, hhp, hg, hlfo, hd],
      params: {},
    }
  }

  // ---------- loop infrastructure ----------

  private ensureLoop(
    id: string,
    pos: AudioPosition | null,
    build: (out: GainNode) => LoopParts | null
  ): LoopNode | null {
    const existing = this.loops.get(id)
    if (existing) return existing
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return null
    try {
      const ctrl = ctx.createGain()
      ctrl.gain.value = 0
      let panner: PannerNode | null = null
      if (pos) panner = this.makePanner(pos)
      if (panner) {
        ctrl.connect(panner)
        panner.connect(master)
      } else {
        ctrl.connect(master)
      }
      const parts = build(ctrl)
      if (!parts) {
        try {
          ctrl.disconnect()
          if (panner) panner.disconnect()
        } catch {
          /* ignore */
        }
        return null
      }
      const loop: LoopNode = {
        id,
        ctrl,
        panner,
        sources: parts.sources,
        cleanup: [ctrl, ...(panner ? [panner] : []), ...parts.cleanup],
        params: parts.params,
      }
      this.loops.set(id, loop)
      return loop
    } catch {
      return null
    }
  }

  private killLoop(id: string, fade: number): void {
    const loop = this.loops.get(id)
    if (!loop) return
    this.loops.delete(id)
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const f = Math.max(0.05, fade)
    try {
      loop.ctrl.gain.setTargetAtTime(0.0001, t, f / 3)
    } catch {
      /* ignore */
    }
    const stopAt = t + f + 0.15
    let stopped = false
    const dispose = (): void => {
      if (stopped) return
      stopped = true
      for (const node of loop.cleanup) {
        try {
          node.disconnect()
        } catch {
          /* ignore */
        }
      }
    }
    for (const s of loop.sources) {
      s.onended = dispose
      try {
        s.stop(stopAt)
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- spatial helpers ----------

  private makePanner(pos: AudioPosition): PannerNode | null {
    const ctx = this.ctx
    if (!ctx) return null
    try {
      const p = ctx.createPanner()
      p.panningModel = 'equalpower'
      p.distanceModel = 'inverse'
      p.refDistance = 3
      p.rolloffFactor = 1.2
      p.maxDistance = 10000
      if (this.doppler) {
        try {
          // legacy knob, removed from modern spec typings — best effort only
          const legacy = p as unknown as { dopplerFactor?: number }
          legacy.dopplerFactor = 1
        } catch {
          /* not supported — fine */
        }
      }
      this.setNodePos(p, pos)
      return p
    } catch {
      return null
    }
  }

  private setNodePos(p: PannerNode, pos: AudioPosition): void {
    try {
      if (p.positionX) {
        p.positionX.value = pos.x
        p.positionY.value = pos.y
        p.positionZ.value = pos.z
      } else {
        p.setPosition(pos.x, pos.y, pos.z)
      }
    } catch {
      /* ignore */
    }
  }

  // ---------- one-shot infrastructure ----------

  /** Gate + try/catch wrapper for fire-and-forget one-shots. */
  private guard(fn: (ctx: AudioContext, master: GainNode) => void): void {
    const ctx = this.ctx
    const master = this.master
    if (!this.ready || !ctx || !master) return
    if (this.shots >= this.SHOT_CAP) return
    try {
      fn(ctx, master)
    } catch {
      /* audio must never throw into the game loop */
    }
  }

  /** Registers one-shot sources for bounded lifetime + node cleanup. */
  private trackShot(sources: AudioScheduledSourceNode[], cleanup: AudioNode[], stopAt: number): void {
    this.shots++
    let left = sources.length
    const done = (): void => {
      left -= 1
      if (left > 0) return
      this.shots = Math.max(0, this.shots - 1)
      for (const n of cleanup) {
        try {
          n.disconnect()
        } catch {
          /* ignore */
        }
      }
    }
    for (const s of sources) {
      s.onended = done
      try {
        s.stop(stopAt)
      } catch {
        /* ignore */
      }
    }
  }

  // simple node factories (only valid after init — callers gate on ready)
  private noise(loop: boolean, which: 'white' | 'brown' = 'white'): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext
    const s = ctx.createBufferSource()
    s.buffer = which === 'white' ? this.white : this.brown
    s.loop = loop
    return s
  }

  private bq(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
    const ctx = this.ctx as AudioContext
    const f = ctx.createBiquadFilter()
    f.type = type
    const nyq = ctx.sampleRate / 2 - 200
    f.frequency.value = Math.max(10, Math.min(freq, nyq))
    if (q !== undefined) f.Q.value = q
    return f
  }

  private gn(v: number): GainNode {
    const g = (this.ctx as AudioContext).createGain()
    g.gain.value = v
    return g
  }

  private osc(type: OscillatorType, freq: number): OscillatorNode {
    const o = (this.ctx as AudioContext).createOscillator()
    o.type = type
    o.frequency.value = Math.max(1, freq)
    return o
  }

  /** Generic short tone with soft envelope; optional exponential glide. */
  private tone(
    t: number,
    freq: number,
    dur: number,
    vol: number,
    type: OscillatorType = 'sine',
    glideTo = 0
  ): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const o = this.osc(type, freq)
    const g = this.gn(0.0001)
    o.connect(g)
    g.connect(master)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.018)
    g.gain.setTargetAtTime(0.0001, t + dur * 0.55, Math.max(0.02, dur * 0.16))
    if (glideTo > 0) {
      o.frequency.setValueAtTime(Math.max(1, freq), t)
      o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.9)
    }
    o.start(t)
    this.trackShot([o], [o, g], t + dur + 0.4)
  }

  /** Tiny filtered-noise tick (squelch clicks, latch clicks). */
  private click(t: number, freq: number, vol: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const src = this.noise(true, 'white')
    const bp = this.bq('bandpass', freq, 1.4)
    const g = this.gn(0.0001)
    src.connect(bp)
    bp.connect(g)
    g.connect(master)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.006)
    g.gain.setTargetAtTime(0.0001, t + 0.008, 0.012)
    src.start(t)
    this.trackShot([src], [src, bp, g], t + 0.18)
  }

  /** Short low thump used to accent ratchet final clacks. */
  private thumpTick(t: number, vol: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const o = this.osc('sine', 130)
    const g = this.gn(0.0001)
    o.connect(g)
    g.connect(master)
    o.frequency.setValueAtTime(130, t)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.006)
    g.gain.setTargetAtTime(0.0001, t + 0.01, 0.03)
    o.start(t)
    this.trackShot([o], [o, g], t + 0.3)
  }

  // ---------- scheduler (alarm + heartbeat) ----------

  private schedTick(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    if (this.alarmOn) {
      if (t >= this.nextAlarmAt) {
        this.alarmBeep(t + 0.06, this.alarmHi ? 880 : 660)
        this.alarmHi = !this.alarmHi
        this.nextAlarmAt = t + 1.2
      }
    } else {
      this.nextAlarmAt = 0
    }
    if (this.heartLevel > 0.02) {
      if (t >= this.nextHeartAt) {
        this.heartBeat(t + 0.06)
        const bpm = 60 + clamp01(this.heartLevel) * 72
        this.nextHeartAt = t + 60 / bpm
      }
    } else {
      this.nextHeartAt = 0
    }
  }

  private alarmBeep(t: number, freq: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    try {
      const o = this.osc('sine', freq)
      const h = this.osc('sine', freq * 2)
      const hg = this.gn(0.22)
      const g = this.gn(0.0001)
      o.connect(g)
      h.connect(hg)
      hg.connect(g)
      g.connect(master)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.11, t + 0.014)
      g.gain.setValueAtTime(0.11, t + 0.1)
      g.gain.setTargetAtTime(0.0001, t + 0.11, 0.04)
      o.start(t)
      h.start(t)
      this.trackShot([o, h], [o, h, g, hg], t + 0.4)
    } catch {
      /* ignore */
    }
  }

  private heartBeat(t: number): void {
    const ctx = this.ctx
    const bus = this.heartGain
    if (!ctx || !bus) return
    try {
      const oscs: OscillatorNode[] = []
      const nodes: AudioNode[] = []
      const pair = (dt: number, amp: number, f0: number): void => {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.setValueAtTime(f0, t + dt)
        o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + dt + 0.13)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + dt)
        g.gain.linearRampToValueAtTime(amp, t + dt + 0.02)
        g.gain.setTargetAtTime(0.0001, t + dt + 0.035, 0.05)
        o.connect(g)
        g.connect(bus)
        o.start(t + dt)
        oscs.push(o)
        nodes.push(o, g)
      }
      pair(0, 1, 52) // lub
      pair(0.21, 0.62, 44) // dub
      this.trackShot(oscs, nodes, t + 0.75)
    } catch {
      /* ignore */
    }
  }
}

/** Shared singleton — safe to import and call from anywhere. */
export const audio = new AudioEngine()
