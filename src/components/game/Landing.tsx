// Landing cinematic — multishot powered descent on the real lander asset.
//
// Design contract (single-clock choreography):
//  - ONE elapsed clock `t` drives EVERYTHING: shot selection, camera pose,
//    lander altitude, effects and radio lines. Shots are cut purely by where
//    `t` sits inside the fixed SHOTS table, so a shot that ends at 4.6s is
//    replaced the same frame by the shot that starts at 4.6s — zero drift,
//    zero overlap (the old "5s feels like 4.5s" desync is impossible).
//  - The ship is ALWAYS in focus: every shot's camera lookAt() tracks the
//    live lander position each frame — it can never leave the frame.
//  - Hard cuts are softened with fade-through-black dips at shot boundaries
//    (HTML overlay driven by the same clock) plus fade-in from black and a
//    fade-out into the next stage.
//  - The user-supplied mission-control chatter ("cutscene audio") plays LOUD
//    from t=0. Radio text lines fire in the SAME pass — the sequence plays
//    exactly once.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { audio } from '@/game/audio'
import { emitBurst, emit } from './particles'
import { heightAt } from '@/game/terrain'
import { fpState } from './Player'
import LanderAsset from './LanderAsset'
import EnginePlume from './Plume'

const DURATION = 19.0 // holds on the landed ship through the final radio lines
const TOUCH_T = 13.6
const GROUND_Y = heightAt(0, 0)
// ?cdfast=N — verification accelerator (runs the cinematic clock N× faster;
// normal play is unaffected). Same pattern as the ?debug=1 console hooks.
const DT_SCALE = typeof window !== 'undefined'
  ? Math.max(1, Number(new URLSearchParams(window.location.search).get('cdfast')) || 1)
  : 1

// radio script — fired once each, in the same pass as the audio
const RADIO_LINES: [number, string][] = [
  [0.6, 'Mission Control: Final descent. Throttle up — trust the guidance loop.'],
  [5.5, 'Descent stage: 60 meters. Velocity nominal.'],
  [9.5, 'Descent stage: 20 meters. Dust cloud developing below.'],
  [TOUCH_T + 0.8, 'Mission Control: Contact light. Engine shutdown. Welcome to the surface.'],
  [TOUCH_T + 3.2, 'Mission Control: We are go for base camp deployment. Set up solar first — everything else depends on it.'],
]

// shot list — [start, end) with camera dolly from→to and framing params.
// from/to Y is authored as HEIGHT ABOVE THE LOCAL TERRAIN (the frame loop
// samples heightAt under the live camera position) — a rolling dune can never
// bury a shot again (the old "every scene after the first is underground" bug:
// absolute Ys like 1.7 sat below the y≈3.36 pad soil).
interface Shot {
  start: number
  end: number
  from: [number, number, number]
  to: [number, number, number]
  fov: number
  aimLift: number
}
const SHOTS: Shot[] = [
  // 1 — ESTABLISH: high wide on the ridge, ship descending against the sky
  { start: 0.0, end: 4.6, from: [46, 17.5, 52], to: [40, 12, 46], fov: 50, aimLift: 2.6 },
  // 2 — LOW ANGLE: from the pad looking up as the ship swells overhead
  { start: 4.6, end: 9.2, from: [15, 1.9, 21], to: [11.5, 1.55, 16.5], fov: 58, aimLift: 2.2 },
  // 3 — TRACKING CLOSE: side profile through the dust storm, engine wash glowing
  { start: 9.2, end: 13.6, from: [-14, 2.5, 18], to: [-10.5, 2.1, 12.5], fov: 55, aimLift: 2.0 },
  // 4 — TOUCHDOWN: ground-level push-in on the landed ship, holds through the
  // final "go for base camp deployment" radio traffic, then fades out
  { start: 13.6, end: DURATION, from: [6.8, 1.6, 9.2], to: [5.6, 1.35, 7.6], fov: 62, aimLift: 2.2 },
]
const CUT_WINDOWS = SHOTS.slice(1).map((s) => s.start) // 4.6, 9.2, 13.6
const FADE_HALF = 0.22 // seconds each side of a cut spent inside the black dip

// DOM fade overlay registry — the overlay lives OUTSIDE the Canvas (a div can
// never be an R3F child); the frame loop writes its opacity through this ref.
const fadeElRef: { current: HTMLDivElement | null } = { current: null }

/** Fullscreen fade overlay, rendered by GameRoot as a sibling of the Canvas. */
export function LandingFadeOverlay() {
  return (
    <div
      ref={(el) => {
        fadeElRef.current = el
      }}
      className="pointer-events-none fixed inset-0 z-40 bg-black"
      style={{ opacity: 1 }}
      aria-hidden
    />
  )
}

export default function LandingCinematic() {
  const { camera } = useThree()
  const tRef = useRef(0)
  const lander = useRef<THREE.Group>(null)
  const plume = useRef<THREE.Group>(null)
  const plumeLight = useRef<THREE.PointLight>(null)
  const groundGlow = useRef<THREE.Mesh>(null)
  const groundLight = useRef<THREE.PointLight>(null)
  const radioFlags = useRef<Record<number, boolean>>({})
  const touched = useRef(false)
  const fovRef = useRef(0)
  const aim = useRef(new THREE.Vector3())

  useEffect(() => {
    audio.landingBurn(true)
    // the user-supplied mission-control chatter — very loud, clearly above the
    // engine rumble (the mix the user asked for: chatter > ship/engine sound)
    audio.setCutsceneChatter(true, 1.5)
    const cam = camera as THREE.PerspectiveCamera
    return () => {
      audio.landingBurn(false)
      audio.setCutsceneChatter(false)
      audio.setConstructionMotor(false, 0)
      // restore the gameplay lens (skip path can leave mid-shot)
      cam.fov = 75
      cam.updateProjectionMatrix()
    }
  }, [camera])

  useFrame((_, dtRaw) => {
    const st = useGame.getState()
    if (st.screen !== 'landing') return
    const dt = Math.min(dtRaw, 0.05) * DT_SCALE
    tRef.current += dt
    const t = tRef.current
    const p = Math.min(1, t / TOUCH_T)
    const alt = Math.pow(1 - p, 1.75) * 115
    const y = GROUND_Y + alt

    if (lander.current) {
      lander.current.position.y = y
      // slow tumble that settles — rotation eases back to 0 so the world
      // lander (rot 0) matches at control hand-off
      lander.current.rotation.y = 0.8 * (1 - THREE.MathUtils.smoothstep(p, 0.5, 1))
      lander.current.rotation.z = (1 - p) * 0.02 * Math.sin(t * 0.8)
    }
    // engine fire — long plume, flaring as it nears the surface
    const burning = t < TOUCH_T
    if (plume.current) {
      plume.current.visible = burning
      if (burning) {
        const flick = 0.9 + Math.random() * 0.25
        const len = THREE.MathUtils.clamp(alt * 0.16, 2.8, 16)
        plume.current.scale.set(flick, len, flick)
        plume.current.position.y = 0.95
      }
    }
    if (plumeLight.current) {
      plumeLight.current.visible = burning
      plumeLight.current.intensity = burning ? 60 + Math.random() * 30 : 0
    }
    // engine wash hitting the surface — glow + light grow as it descends
    const near = burning ? THREE.MathUtils.clamp(1 - alt / 26, 0, 1) : 0
    if (groundLight.current) {
      groundLight.current.visible = near > 0.02
      groundLight.current.intensity = near * (110 + Math.random() * 50)
    }
    if (groundGlow.current) {
      groundGlow.current.visible = near > 0.02
      const gm = groundGlow.current.material as THREE.MeshBasicMaterial
      gm.opacity = near * (0.5 + Math.random() * 0.22)
      const s = 0.85 + (1 - near) * 0.5
      groundGlow.current.scale.set(s, s, s)
    }
    // dust kicked by engine wash (radial storm as thrust nears the ground)
    if (burning && alt < 30) {
      const strength = 1 - alt / 30
      if (Math.random() < 0.95) {
        const a = Math.random() * Math.PI * 2
        const r = 4 + (1 - strength) * 17 * Math.random()
        emit({
          pos: [Math.cos(a) * r, heightAt(Math.cos(a) * r, Math.sin(a) * r) + 0.25, Math.sin(a) * r],
          vel: [Math.cos(a) * (5 + strength * 12), 1.0 + Math.random() * 1.8, Math.sin(a) * (5 + strength * 12)],
          life: 2.6, size: 1.0, color: '#a09a8e', gravity: -0.4, drag: 0.15,
        })
      }
    }
    // touchdown
    if (!touched.current && t >= TOUCH_T) {
      touched.current = true
      audio.landingBurn(false)
      audio.touchdown()
      audio.thud(1)
      fpState.shake = 1.4
      emitBurst([0, GROUND_Y + 0.4, 0], 70, { speed: 12, life: 2.8, size: 1.0, color: '#a89f90', up: 0.55 })
    }
    // radio script (single pass — same timeline as the audio). Text + blip
    // only: the synthesized gibberish voice ("sho sho sho") is removed — the
    // real mission-control chatter mp3 owns the voice channel.
    for (const [tt, text] of RADIO_LINES) {
      if (t >= tt && !radioFlags.current[tt]) {
        radioFlags.current[tt] = true
        st.radio(text)
        audio.radioBlip()
      }
    }

    // ---------- multishot camera (pure function of t — perfectly synced) ----------
    let shot = SHOTS[0]
    for (const s of SHOTS) {
      if (t >= s.start && t < s.end) {
        shot = s
        break
      }
    }
    const lp = (t - shot.start) / (shot.end - shot.start) // local progress 0..1
    const ease = lp * lp * (3 - 2 * lp) // smoothstep dolly
    const shake = Math.max(0, fpState.shake) * (Math.random() - 0.5)
    const cx = THREE.MathUtils.lerp(shot.from[0], shot.to[0], ease) + Math.sin(t * 0.7) * 0.22 + shake * 0.4
    const cz = THREE.MathUtils.lerp(shot.from[2], shot.to[2], ease) + Math.cos(t * 0.5) * 0.22 + shake * 0.4
    // terrain-relative height: sample the ground UNDER the final (wobbled) XZ,
    // then add the shot's above-terrain Y — with a hard "never below knee
    // height over the soil" floor so no dune, rock or wobble can clip us under
    const camGround = heightAt(cx, cz)
    const cy = camGround + THREE.MathUtils.lerp(shot.from[1], shot.to[1], ease) + Math.sin(t * 1.1) * 0.13 + shake * 0.4
    camera.position.set(cx, Math.max(cy, camGround + 0.9), cz)
    // the ship is ALWAYS the focus — aim tracks its live position
    aim.current.set(0, y + shot.aimLift, 0)
    camera.lookAt(aim.current.x, aim.current.y + shake * 0.2, aim.current.z)
    if (fovRef.current !== shot.fov) {
      fovRef.current = shot.fov
      ;(camera as THREE.PerspectiveCamera).fov = shot.fov
      ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    }
    fpState.shake *= Math.max(0, 1 - dt * 2.2)

    // ---------- fade transitions (same clock — cannot desync) ----------
    const fe = fadeElRef.current
    if (fe) {
      let f = 0
      // dip to black around every cut
      for (const b of CUT_WINDOWS) {
        f = Math.max(f, 1 - Math.abs(t - b) / FADE_HALF)
      }
      // fade in from black at the very start
      f = Math.max(f, 1 - t / 0.9)
      // fade out into the next stage
      f = Math.max(f, (t - (DURATION - 0.6)) / 0.6)
      fe.style.opacity = String(THREE.MathUtils.clamp(f, 0, 1))
    }

    // hand off control — the built-in INTREPID title sequence plays next,
    // then the mission film, then gameplay
    if (t >= DURATION) {
      audio.success()
      st.setScreen('trailer')
    }
  })

  return (
    <group>
      <group ref={lander} position={[0, 115, 0]}>
        {/* the real lander — 6× the astronaut model */}
        <LanderAsset />
        {/* engine fire (extends -Y from the bell) */}
        <group ref={plume} position={[0, 0.95, 0]}>
          <EnginePlume />
        </group>
        <pointLight ref={plumeLight} position={[0, -1.2, 0]} color="#ffc070" intensity={70} distance={170} decay={2} />
      </group>
      {/* surface effects under the descent path */}
      <mesh ref={groundGlow} position={[0, GROUND_Y + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[7.5, 32]} />
        <meshBasicMaterial color="#ffb35c" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={groundLight} position={[0, GROUND_Y + 1.4, 0]} color="#ffb35c" intensity={0} distance={60} decay={2} visible={false} />
    </group>
  )
}
