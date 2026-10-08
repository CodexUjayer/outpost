// IntrepidTrailer — the built-in INTREPID title sequence, rendered live by the
// game engine (no external video). Slow cinematic moves around the freshly
// landed ship, crew and rover on the pad, with title cards, then hands off to
// the mission film (the user's trailer video, fullscreen).
//
// Same single-clock contract as the landing cinematic: one elapsed time drives
// shot selection, camera pose, fades and title opacity — cuts are exact and
// cannot drift. The lander stays the lookAt focus in every shot.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { audio } from '@/game/audio'

const DURATION = 13.5
// ?cdfast=N — verification accelerator (see Landing.tsx); 1× in normal play
const DT_SCALE = typeof window !== 'undefined'
  ? Math.max(1, Number(new URLSearchParams(window.location.search).get('cdfast')) || 1)
  : 1

interface TShot {
  start: number
  end: number
  from: [number, number, number]
  to: [number, number, number]
  fov: number
  aimY: number
}
// A — slow orbit around the landed ship · B — pull back and rise, rover reveal
// C — low drift past the crew toward the ship and the horizon
const SHOTS: TShot[] = [
  { start: 0.0, end: 5.2, from: [-13.5, 2.9, 11.5], to: [-9.5, 4.4, 14.5], fov: 48, aimY: 3.1 },
  { start: 5.2, end: 9.6, from: [10, 2.0, -14], to: [18, 7.5, -23], fov: 52, aimY: 2.6 },
  { start: 9.6, end: DURATION, from: [-17, 2.1, -9], to: [-14, 1.9, -7], fov: 55, aimY: 2.8 },
]
const CUT_WINDOWS = SHOTS.slice(1).map((s) => s.start)
const FADE_HALF = 0.22

// DOM overlay registry — the title cards / fades live OUTSIDE the Canvas (a div
// can never be an R3F child); the frame loop writes styles through these refs.
const els: {
  fade: HTMLDivElement | null
  title: HTMLDivElement | null
  cap: HTMLDivElement | null
  close: HTMLDivElement | null
} = { fade: null, title: null, cap: null, close: null }

/** Title cards + fade overlay, rendered by GameRoot as a sibling of the Canvas. */
export function IntrepidTrailerOverlay() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[46]" aria-hidden>
        {/* main title */}
        <div
          ref={(el) => { els.title = el }}
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ opacity: 0 }}
        >
          <div className="font-mono text-[10px] tracking-[0.6em] text-amber-200/70 sm:text-xs">
            OFF-WORLD COLONY PROGRAM
          </div>
          <h1 className="mt-4 text-5xl font-bold tracking-[0.42em] text-stone-100 sm:text-7xl" style={{ textIndent: '0.42em', textShadow: '0 0 42px rgba(0,0,0,0.85)' }}>
            INTREPID
          </h1>
          <div className="mt-5 h-px w-40 bg-stone-400/40 sm:w-56" />
          <div className="mt-4 font-mono text-[10px] tracking-[0.45em] text-stone-300/80 sm:text-xs">
            A MARS COLONY STORY
          </div>
        </div>
        {/* archive caption */}
        <div ref={(el) => { els.cap = el }} className="absolute bottom-[9vh] left-6 sm:left-10" style={{ opacity: 0 }}>
          <div className="font-mono text-[10px] tracking-[0.35em] text-stone-300/90 sm:text-xs">
            SOL 1 — TRANQUILLITATIS PLANUM
          </div>
          <div className="mt-1 font-mono text-[9px] tracking-[0.2em] text-stone-500/80 sm:text-[10px]">
            DEEP SPACE NETWORK · RELAY 7 · UPLINK ESTABLISHED
          </div>
        </div>
        {/* closing card */}
        <div
          ref={(el) => { els.close = el }}
          className="absolute inset-x-0 bottom-[16vh] flex justify-center px-6"
          style={{ opacity: 0 }}
        >
          <div className="text-center font-mono text-xs tracking-[0.35em] text-stone-200/90 sm:text-sm">
            WHEELS DOWN. NOW THE REAL WORK BEGINS.
          </div>
        </div>
      </div>
      {/* fade-through-black transition overlay */}
      <div
        ref={(el) => { els.fade = el }}
        className="pointer-events-none fixed inset-0 z-40 bg-black"
        style={{ opacity: 1 }}
        aria-hidden
      />
    </>
  )
}

export default function IntrepidTrailer() {
  const { camera } = useThree()
  const tRef = useRef(0)
  const done = useRef(false)
  const blipped = useRef(false)
  const fovRef = useRef(0)
  const aim = useRef(new THREE.Vector3())

  // restore the gameplay camera lens when the sequence ends
  useEffect(() => {
    audio.setBgm(false)
    audio.playMachinery(0.09) // distant generator hum under the titles
    if (document.pointerLockElement) document.exitPointerLock()
    const cam = camera as THREE.PerspectiveCamera
    return () => {
      cam.fov = 75
      cam.updateProjectionMatrix()
      audio.setBgm(true, 0.16)
    }
  }, [camera])

  useFrame((_, dtRaw) => {
    const st = useGame.getState()
    if (st.screen !== 'trailer') return
    const dt = Math.min(dtRaw, 0.05) * DT_SCALE
    tRef.current += dt
    const t = tRef.current

    if (!blipped.current && t >= 1.2) {
      blipped.current = true
      audio.radioBlip()
    }

    // ---------- multishot camera (pure function of t) ----------
    let shot = SHOTS[0]
    for (const s of SHOTS) {
      if (t >= s.start && t < s.end) {
        shot = s
        break
      }
    }
    const lp = (t - shot.start) / (shot.end - shot.start)
    const ease = lp * lp * (3 - 2 * lp)
    camera.position.set(
      THREE.MathUtils.lerp(shot.from[0], shot.to[0], ease) + Math.sin(t * 0.5) * 0.12,
      THREE.MathUtils.lerp(shot.from[1], shot.to[1], ease) + Math.sin(t * 0.8) * 0.07,
      THREE.MathUtils.lerp(shot.from[2], shot.to[2], ease) + Math.cos(t * 0.4) * 0.12,
    )
    aim.current.set(0, shot.aimY, 0)
    camera.lookAt(aim.current)
    if (fovRef.current !== shot.fov) {
      fovRef.current = shot.fov
      ;(camera as THREE.PerspectiveCamera).fov = shot.fov
      ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
    }

    // ---------- fades + title cards (same clock) ----------
    if (els.fade) {
      let f = 0
      for (const b of CUT_WINDOWS) {
        f = Math.max(f, 1 - Math.abs(t - b) / FADE_HALF)
      }
      f = Math.max(f, 1 - t / 1.0) // in from the landing handoff
      f = Math.max(f, (t - (DURATION - 0.7)) / 0.7) // out into the film
      els.fade.style.opacity = String(THREE.MathUtils.clamp(f, 0, 1))
    }
    if (els.title) els.title.style.opacity = String(inOut(t, 1.2, 2.1, 4.4, 5.1))
    if (els.cap) els.cap.style.opacity = String(inOut(t, 5.9, 6.6, 8.9, 9.5))
    if (els.close) els.close.style.opacity = String(inOut(t, 10.1, 10.9, 12.4, 13.0))

    if (!done.current && t >= DURATION) {
      done.current = true
      st.setScreen('cutscene')
    }
  })

  // cinematic hero lighting for the title sequence — mounted only while the
  // trailer runs (the night pad is too dark to read the ship otherwise)
  return (
    <group>
      <directionalLight position={[-22, 12, 18]} intensity={1.15} color="#dfe8ff" />
      <pointLight position={[7, 5.5, -9]} intensity={34} distance={46} decay={2} color="#ffd9a8" />
      <pointLight position={[-6, 2.2, 6]} intensity={12} distance={26} decay={2} color="#9fb4d8" />
    </group>
  )
}

const smooth = (v: number) => {
  const x = THREE.MathUtils.clamp(v, 0, 1)
  return x * x * (3 - 2 * x)
}
/** 0→1 over [a,b], hold, 1→0 over [c,d] */
function inOut(t: number, a: number, b: number, c: number, d: number) {
  return smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)))
}
