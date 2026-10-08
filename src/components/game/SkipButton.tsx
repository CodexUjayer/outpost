'use client'

// ============================================================
// SkipButton — skips the construction cinematic or the landing
// cinematic. Keyboard hold-F is handled by the input layer;
// this is the clickable fallback.
// ============================================================

import { useGame } from '@/game/store'

export default function SkipButton() {
  const g = useGame()
  const construction = g.construction !== null
  const cinematic =
    g.screen === 'landing' || g.screen === 'trailer' || g.screen === 'cutscene'
  if (!construction && !cinematic) return null

  const onSkip = () => {
    if (construction) g.skipConstruction()
    else g.setScreen('playing')
  }

  return (
    <button
      onClick={onSkip}
      className="pointer-events-auto fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border border-stone-600/70 bg-stone-950/80 px-3 py-2 font-mono text-[11px] tracking-widest text-stone-300 backdrop-blur transition-colors hover:border-amber-400/70 hover:text-amber-200"
    >
      SKIP SEQUENCE ▸▸
      <kbd className="rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-[9px] tracking-normal text-stone-500">
        HOLD F
      </kbd>
    </button>
  )
}
