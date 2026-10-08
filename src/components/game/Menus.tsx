'use client'

// ============================================================
// Menus — screen router for non-gameplay UI:
// start menu (planet select + briefing), pause, game over, victory.
// 'landing' renders nothing (cinematic handled elsewhere).
// ============================================================

import { useMemo, useState } from 'react'
import { ChevronDown, Volume2 } from 'lucide-react'
import { useGame } from '@/game/store'
import { PLANETS } from '@/game/types'
import type { Planet } from '@/game/types'

// Deterministic starfield (single div, box-shadow dots) — SSR safe.
function useStarShadows(count: number): string {
  return useMemo(() => {
    const frac = (x: number) => x - Math.floor(x)
    const shadows: string[] = []
    for (let i = 0; i < count; i++) {
      const x = frac(Math.sin(i * 12.9898) * 43758.5453) * 100
      const y = frac(Math.sin(i * 78.233) * 12345.6789) * 100
      const z = frac(Math.sin(i * 39.425) * 9876.54321)
      const size = z > 0.88 ? '0 1px' : '0 0'
      shadows.push(`${x.toFixed(1)}vw ${y.toFixed(1)}vh 0 ${size} rgba(231,229,228,${(0.2 + z * 0.5).toFixed(2)})`)
    }
    return shadows.join(', ')
  }, [count])
}

function Starfield() {
  const shadows = useStarShadows(90)
  return <div className="pointer-events-none absolute left-0 top-0 size-[2px] rounded-full" style={{ boxShadow: shadows }} />
}

// ============================================================
// Start menu
// ============================================================

function StartMenu() {
  const g = useGame()
  const [sel, setSel] = useState<Planet>(g.planet)
  const [briefOpen, setBriefOpen] = useState(false)
  const cfg = PLANETS[sel]

  const hazards = cfg.hasDustStorms
    ? 'Planet-encircling dust storms · thin CO₂ atmosphere · weak sunlight'
    : 'Hard vacuum · unfiltered cosmic radiation · abrasive dust · 29.5-day night'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(120,113,108,0.16), transparent 60%), radial-gradient(ellipse 60% 40% at 85% 110%, rgba(180,83,9,0.10), transparent 60%)',
        }}
      />
      <Starfield />

      <div className="relative mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 px-6 py-12">
        {/* title block */}
        <div className="text-center">
          <h1 className="text-5xl font-bold tracking-[0.18em] text-stone-100 md:text-6xl">OFFWORLD</h1>
          <div className="mt-2 font-mono text-xs tracking-[0.42em] text-amber-400/90">COLONY ENGINEERING PROTOCOL</div>
          <p className="mt-3 text-sm text-stone-400">A NASA-inspired STEM survival sim — land, build, keep everyone breathing.</p>
        </div>

        {/* planet selection */}
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(PLANETS) as Planet[]).map((p) => {
            const c = PLANETS[p]
            const active = sel === p
            return (
              <button
                key={p}
                onClick={() => setSel(p)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  active
                    ? 'border-amber-400/80 bg-stone-900/80 ring-2 ring-amber-400/50'
                    : 'border-stone-700/70 bg-stone-900/40 hover:border-stone-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold tracking-wide text-stone-100">{c.name}</span>
                  <span className={`font-mono text-[10px] tracking-widest ${active ? 'text-amber-300' : 'text-stone-500'}`}>
                    {p === 'moon' ? 'MOON' : 'MARS'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
                  <div>
                    <div className="text-stone-500">GRAVITY</div>
                    <div className="mt-0.5 text-stone-200">{c.gravity} m/s²</div>
                  </div>
                  <div>
                    <div className="text-stone-500">SOLAR</div>
                    <div className="mt-0.5 text-stone-200">{Math.round(c.solarPeak * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-stone-500">RAD</div>
                    <div className="mt-0.5 text-stone-200">{c.baseRad} mSv/h</div>
                  </div>
                </div>
                <div className="mt-3 font-mono text-[10px] leading-snug text-stone-400">HAZARDS: {hazards}</div>
              </button>
            )
          })}
        </div>

        {/* mission briefing */}
        <div className="w-full rounded-lg border border-stone-800 bg-stone-900/30">
          <button
            onClick={() => setBriefOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="font-mono text-[11px] tracking-[0.3em] text-stone-300">
              MISSION BRIEFING — {cfg.name.toUpperCase()}
            </span>
            <ChevronDown className={`size-4 shrink-0 text-stone-500 transition-transform ${briefOpen ? 'rotate-180' : ''}`} />
          </button>
          {briefOpen && (
            <ul className="space-y-2 border-t border-stone-800 px-4 py-3">
              {cfg.facts.map((f, i) => (
                <li key={i} className="flex gap-3 text-xs leading-relaxed text-stone-300">
                  <span className="shrink-0 font-mono text-[10px] text-amber-500/80">{String(i + 1).padStart(2, '0')}</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* controls summary */}
        <div className="text-center font-mono text-[10px] tracking-wider text-stone-500">
          WASD MOVE · SHIFT RUN · SPACE JUMP · E INTERACT · B BUILD · TAB COLONY · ESC PAUSE
        </div>

        {/* begin */}
        <button
          onClick={() => g.startGame(sel)}
          className="rounded-md bg-amber-500 px-8 py-3 text-sm font-semibold tracking-[0.25em] text-stone-950 shadow-lg shadow-amber-900/30 transition-colors hover:bg-amber-400"
        >
          BEGIN LANDING SEQUENCE
        </button>

        <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <Volume2 className="size-3.5" />
          <span>Audio is procedural — sound on recommended</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Pause overlay
// ============================================================

function PauseOverlay() {
  const g = useGame()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm">
      <div className="w-80 rounded-lg border border-stone-700/70 bg-stone-950/95 p-6 text-center">
        <div className="font-mono text-lg tracking-[0.4em] text-stone-100">PAUSED</div>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => g.setPaused(false)}
            className="rounded-md bg-stone-200 px-4 py-2 text-xs font-semibold tracking-[0.2em] text-stone-950 hover:bg-white"
          >
            RESUME
          </button>
          <button
            onClick={() => g.restart()}
            className="rounded-md border border-stone-600 px-4 py-2 font-mono text-xs tracking-[0.2em] text-stone-300 transition-colors hover:border-red-500/60 hover:text-red-300"
          >
            RESTART MISSION
          </button>
        </div>
        <div className="mt-6 space-y-1 border-t border-stone-800 pt-4 font-mono text-[10px] leading-relaxed text-stone-500">
          <div>WASD MOVE · SHIFT RUN · SPACE JUMP</div>
          <div>E INTERACT · B BUILD · TAB COLONY</div>
          <div>R ROVER · T TIME · ESC PAUSE</div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Game over
// ============================================================

function GameOverScreen() {
  const g = useGame()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(127,29,29,0.28), transparent 65%)' }}
      />
      <div className="relative w-full max-w-lg rounded-lg border border-red-900/60 bg-stone-950/95 p-6 text-center">
        <div className="font-mono text-xl tracking-[0.35em] text-red-400">MISSION FAILED</div>
        {g.failureReason && <p className="mt-4 text-sm leading-relaxed text-stone-200">{g.failureReason}</p>}
        <div className="mt-5 grid grid-cols-3 gap-2 border-y border-stone-800 py-4 font-mono">
          <div>
            <div className="text-[10px] text-stone-500">SOLS SURVIVED</div>
            <div className="mt-1 text-lg text-stone-100">{g.sol}</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500">POPULATION</div>
            <div className="mt-1 text-lg text-stone-100">{g.population}</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500">EVENTS WEATHERED</div>
            <div className="mt-1 text-lg text-stone-100">{g.eventsSurvived}</div>
          </div>
        </div>
        <div className="mt-5 text-left">
          <div className="font-mono text-[10px] tracking-[0.3em] text-stone-500">WHAT WENT WRONG</div>
          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            Off-world survival is a chain: power → oxygen → water → food. A single broken link ends everything.
            Redundancy, early repairs and rationing keep the chain intact.
          </p>
        </div>
        <button
          onClick={() => g.restart()}
          className="mt-6 rounded-md border border-red-500/50 bg-red-950/40 px-8 py-2.5 text-xs font-semibold tracking-[0.25em] text-red-300 transition-colors hover:bg-red-900/40"
        >
          RETURN TO MENU
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Victory
// ============================================================

function VictoryScreen() {
  const g = useGame()
  const s = g.victoryStats
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 35%, rgba(16,185,129,0.14), rgba(180,83,9,0.08) 45%, transparent 70%)' }}
      />
      <div className="relative w-full max-w-lg rounded-lg border border-emerald-800/60 bg-stone-950/95 p-6 text-center">
        <div className="font-mono text-xl tracking-[0.3em] text-emerald-300">COLONY SELF-SUSTAINING</div>
        <p className="mt-2 text-xs text-stone-400">Phase 7 reached — the colony now produces everything it consumes.</p>
        <div className="mt-5 grid grid-cols-3 gap-2 border-y border-stone-800 py-4 font-mono">
          <div>
            <div className="text-[10px] text-stone-500">SOLS</div>
            <div className="mt-1 text-lg text-stone-100">{s ? s.sols : g.sol}</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500">POPULATION</div>
            <div className="mt-1 text-lg text-stone-100">{s ? s.pop : g.population}</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500">EVENTS WEATHERED</div>
            <div className="mt-1 text-lg text-stone-100">{s ? s.eventsSurvived : g.eventsSurvived}</div>
          </div>
        </div>
        <div className="mt-5 text-left">
          <div className="font-mono text-[10px] tracking-[0.3em] text-stone-500">FIELD NOTES</div>
          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            Every gram of oxygen, water and food was made locally: ice drilled from regolith, air split by electrolysis,
            crops grown under LEDs. ISRU plus closed-loop life support is how humans live beyond Earth — no resupply
            ships required.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => g.setScreen('playing')}
            className="rounded-md border border-stone-600 px-5 py-2.5 font-mono text-xs tracking-[0.2em] text-stone-200 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
          >
            CONTINUE OBSERVING
          </button>
          <button
            onClick={() => g.restart()}
            className="rounded-md bg-emerald-600 px-5 py-2.5 text-xs font-semibold tracking-[0.2em] text-stone-950 transition-colors hover:bg-emerald-500"
          >
            NEW MISSION
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Router
// ============================================================

export default function Menus() {
  const g = useGame()

  if (g.screen === 'landing' || g.screen === 'cutscene') return null
  if (g.screen === 'playing') return g.paused ? <PauseOverlay /> : null
  if (g.screen === 'gameover') return <GameOverScreen />
  if (g.screen === 'victory') return <VictoryScreen />
  return <StartMenu />
}
