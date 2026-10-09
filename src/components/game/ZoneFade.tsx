// ZoneFade — brief black cover when teleporting between the surface and the
// spaceship habitat deck (boarding/exit). Keeps the transition cinematic
// instead of an obvious snap, without a long loading sequence.
'use client'
import { useEffect, useRef, useState } from 'react'
import { useGame } from '@/game/store'

export default function ZoneFade() {
  const [covered, setCovered] = useState(false)
  const wasInside = useRef<string | null | undefined>(undefined)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      const shipChange =
        s.inside !== prev.inside &&
        (s.inside === 'ship' || prev.inside === 'ship') &&
        s.screen === 'playing'
      if (shipChange) {
        setCovered(true)
        if (timer.current) window.clearTimeout(timer.current)
        // reveal after the teleport frame has settled
        timer.current = window.setTimeout(() => setCovered(false), 420)
      }
      if (s.screen !== 'playing') {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCovered(false), 0)
      }
    })
    return () => {
      unsub()
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[75] bg-black transition-opacity duration-700 ${covered ? 'opacity-100' : 'opacity-0'}`}
      aria-hidden
    />
  )
}
