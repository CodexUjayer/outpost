// VideoCutscene — the "INTREPID" mission film that plays between the landing
// cinematic and surface gameplay. Full-screen, letterboxed, fades in/out.
// Uses the game's screen-flow architecture (screen === 'cutscene'); skipping is
// handled by the shared hold-F input (SimDriver) and SkipButton.
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useGame } from '@/game/store'
import { audio } from '@/game/audio'

const VIDEO_URL = '/videos/intrepid-cutscene.mp4'
const FADE_OUT_S = 1.1

export default function VideoCutscene() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const finished = useRef(false)
  const fading = useRef(false)
  const [needsGesture, setNeedsGesture] = useState(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    const st = useGame.getState()
    st.radio("You've seen the Intrepid archive. Wheels down — the colony won't build itself.")
    st.setScreen('playing')
  }, [])

  // duck game audio while the film plays; restore on exit
  useEffect(() => {
    audio.setBgm(false)
    const st = useGame.getState()
    if (document.pointerLockElement) document.exitPointerLock()
    void st
    return () => {
      audio.setBgm(true, 0.16)
    }
  }, [])

  // playback + progress + auto-finish
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let raf = 0
    const tick = () => {
      if (barRef.current && v.duration > 0) {
        const p = Math.min(1, v.currentTime / v.duration)
        barRef.current.style.transform = `scaleX(${p})`
      }
      if (!fading.current && v.duration > 0 && v.currentTime >= v.duration - FADE_OUT_S) {
        fading.current = true
        if (wrapRef.current) wrapRef.current.style.opacity = '0'
        // give the fade a beat, then hand off to gameplay
        window.setTimeout(finish, FADE_OUT_S * 620)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const attempt = () => {
      v.play().catch(() => setNeedsGesture(true))
    }
    attempt()
    const onEnded = () => {
      if (!fading.current) {
        fading.current = true
        if (wrapRef.current) wrapRef.current.style.opacity = '0'
        window.setTimeout(finish, 600)
      }
    }
    v.addEventListener('ended', onEnded)
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('ended', onEnded)
      v.pause()
    }
  }, [finish])

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[70] bg-black transition-opacity duration-700 select-none"
      role="dialog"
      aria-label="Mission film playback"
    >
      {/* the film — object-cover: always fills the screen edge-to-edge
          (center-cropped, never pillarboxed) */}
      <video
        ref={videoRef}
        src={VIDEO_URL}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        preload="auto"
      />

      {/* subtle vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 90% 84% at 50% 50%, transparent 62%, rgba(0,0,0,0.42) 100%)' }}
      />

      {/* lower-third archive caption — NASA transcript style */}
      <div className="pointer-events-none absolute bottom-[8.5vh] left-6 sm:left-10">
        <div className="font-mono text-[10px] tracking-[0.35em] text-stone-400/90 sm:text-xs">
          MISSION ARCHIVE — TRANSMISSION &ldquo;INTREPID&rdquo;
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.2em] text-stone-500/80 sm:text-[10px]">
          DEEP SPACE NETWORK · RELAY 7 · PLAYBACK
        </div>
      </div>

      {/* progress line */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[6vh] h-[2px] bg-stone-800/70">
        <div ref={barRef} className="h-full origin-left scale-x-0 bg-amber-200/80" />
      </div>

      {/* click-to-start fallback (autoplay-with-sound blocked) */}
      {needsGesture && (
        <button
          onClick={() => {
            setNeedsGesture(false)
            audio.resume()
            videoRef.current?.play().catch(() => setNeedsGesture(true))
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/80"
        >
          <span className="border border-stone-600 bg-stone-950/80 px-6 py-3 font-mono text-xs tracking-[0.3em] text-stone-200">
            ▶ PLAY MISSION FILM
          </span>
        </button>
      )}
    </div>
  )
}

/** Hidden preload so the film is buffered during the landing cinematic. */
export function VideoPreload() {
  return (
    <video src={VIDEO_URL} preload="auto" className="hidden" aria-hidden muted playsInline />
  )
}
