'use client'
import dynamic from 'next/dynamic'

const GameRoot = dynamic(() => import('@/components/game/GameRoot'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="text-stone-300 font-mono text-sm animate-pulse">
        Initializing off-world systems…
      </div>
    </div>
  ),
})

export default function Page() {
  return <GameRoot />
}
