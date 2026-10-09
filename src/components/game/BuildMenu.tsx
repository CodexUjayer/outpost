'use client'

// ============================================================
// BuildMenu — the CONSTRUCTION FABRICATOR. Lists buildings,
// locked/unaffordable states, starts placement mode.
// ============================================================

import { Boxes, Lock, X, Zap } from 'lucide-react'
import { useGame } from '@/game/store'
import { BUILD_ORDER, BUILDINGS } from '@/game/buildings'

export default function BuildMenu() {
  const g = useGame()
  if (!g.buildMenuOpen || g.screen !== 'playing') return null

  const mats = Math.floor(g.res.materials.amount)

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 w-full max-w-3xl -translate-x-1/2 px-3">
      <div className="pointer-events-auto rounded-lg border border-stone-700/70 bg-stone-950/95 shadow-2xl shadow-black/60 backdrop-blur">
        {/* header */}
        <div className="flex items-center justify-between border-b border-stone-800 px-4 py-2.5">
          <div className="font-mono text-xs tracking-[0.25em] text-amber-400/90">CONSTRUCTION FABRICATOR</div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs text-stone-300">
              <Boxes className="size-3.5 text-stone-400" />
              {mats} mats
            </span>
            <button
              onClick={() => g.toggleBuildMenu(false)}
              title="Close (B)"
              className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* building grid */}
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3">
          {BUILD_ORDER.map((type) => {
            const def = BUILDINGS[type]
            const locked = def.unlockPhase > g.phase
            const afford = g.res.materials.amount >= def.cost
            return (
              <button
                key={type}
                onClick={() => g.beginPlacement(type)}
                className={`rounded-md border p-2.5 text-left transition-colors ${
                  locked
                    ? 'cursor-default border-stone-800 bg-stone-950/60 opacity-55'
                    : afford
                      ? 'border-stone-600/70 bg-stone-900/70 hover:border-amber-400/70 hover:bg-stone-800/80'
                      : 'border-stone-800 bg-stone-950/70 opacity-80 hover:border-stone-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-stone-100">{def.name}</span>
                  {locked ? (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-stone-500">
                      <Lock className="size-3" />
                      PHASE {def.unlockPhase}
                    </span>
                  ) : (
                    <span
                      className={`flex shrink-0 items-center gap-1 font-mono text-[11px] ${afford ? 'text-stone-300' : 'text-red-400'}`}
                    >
                      <Boxes className="size-3" />
                      {def.cost}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 min-h-[26px] text-[10px] leading-snug text-stone-400">{def.desc}</p>
                <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-stone-500">
                  {def.powerUse > 0 && (
                    <span className="flex items-center gap-1">
                      <Zap className="size-3" />
                      {def.powerUse} U/sol
                    </span>
                  )}
                  <span>{def.footprint.toFixed(1)} m</span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="border-t border-stone-800 px-4 py-1.5 text-center font-mono text-[10px] text-stone-600">
          Select a structure, then left-click terrain to confirm · Right-click / Esc to cancel
        </div>
      </div>
    </div>
  )
}
