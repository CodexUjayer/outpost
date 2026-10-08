'use client'

// ============================================================
// ColonyPanel — colony operations dialog. Systems health,
// production/consumption rates, research upgrades, event log.
// ============================================================

import { FlaskConical, Wrench, X, Zap } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGame } from '@/game/store'
import { BUILDINGS, UPGRADES } from '@/game/buildings'
import { phaseName } from '@/game/simulation'
import type { LogEntry } from '@/game/types'

const LOG_COLOR: Record<LogEntry['kind'], string> = {
  info: 'text-stone-300',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  crit: 'text-red-400',
}

function RateRow({ label, gen, use, unit = '' }: { label: string; gen: number; use: number; unit?: string }) {
  const f = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1))
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-stone-400">{label}</span>
      <span className="whitespace-nowrap font-mono text-stone-200">
        <span className="text-emerald-400">+{f(gen)}</span>
        <span className="text-stone-600"> / </span>
        <span className="text-red-400">-{f(use)}</span>
        <span className="ml-0.5 text-[9px] text-stone-500">{unit}/sol</span>
      </span>
    </div>
  )
}

export default function ColonyPanel() {
  const g = useGame()
  if (!g.colonyPanelOpen || g.screen !== 'playing') return null

  const r = g.rates
  const battPct = g.battery.cap > 0 ? (g.battery.charge / g.battery.cap) * 100 : 0

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => g.toggleColonyPanel(false)}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-stone-700/70 bg-stone-950/95 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
          <div>
            <div className="font-mono text-xs tracking-[0.25em] text-amber-400/90">COLONY OPERATIONS</div>
            <div className="mt-0.5 font-mono text-[10px] text-stone-500">
              SOL {g.sol} · PHASE {g.phase} — {phaseName(g.phase)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-stone-700 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">ESC</kbd>
            <button
              onClick={() => g.toggleColonyPanel(false)}
              title="Close"
              className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <Tabs defaultValue="systems" className="p-4">
          <TabsList className="border border-stone-800 bg-stone-900">
            <TabsTrigger
              value="systems"
              className="font-mono text-[11px] tracking-widest data-[state=active]:bg-stone-700 data-[state=active]:text-stone-100"
            >
              SYSTEMS
            </TabsTrigger>
            <TabsTrigger
              value="research"
              className="font-mono text-[11px] tracking-widest data-[state=active]:bg-stone-700 data-[state=active]:text-stone-100"
            >
              RESEARCH
            </TabsTrigger>
            <TabsTrigger
              value="log"
              className="font-mono text-[11px] tracking-widest data-[state=active]:bg-stone-700 data-[state=active]:text-stone-100"
            >
              LOG
            </TabsTrigger>
          </TabsList>

          {/* ============ SYSTEMS ============ */}
          <TabsContent value="systems" className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {/* structures */}
            <div className="space-y-1.5">
              {g.buildings.map((b) => {
                const def = BUILDINGS[b.type]
                const label = b.id === 'lander' ? 'Lander — Base Camp' : def.name
                const dot = !b.online ? 'bg-stone-500' : b.health < 40 ? 'bg-red-500' : 'bg-emerald-500'
                const bar = b.health < 40 ? 'bg-red-500' : b.health < 70 ? 'bg-amber-400' : 'bg-emerald-500'
                const status = !b.online ? 'OFFLINE' : b.health < 40 ? 'DAMAGED' : 'NOMINAL'
                return (
                  <div
                    key={b.id}
                    className="flex items-center gap-3 rounded-md border border-stone-800 bg-stone-900/40 px-3 py-2"
                  >
                    <span className={`size-2 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-stone-100">{label}</div>
                      <div className="font-mono text-[10px] text-stone-500">
                        {status} · <Zap className="inline size-2.5" /> {def.powerUse} U/sol
                      </div>
                    </div>
                    <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-stone-700/70">
                      <div className={`h-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, b.health))}%` }} />
                    </div>
                    {b.health < 85 ? (
                      <button
                        onClick={() => g.repairBuilding(b.id)}
                        disabled={g.res.materials.amount < 4}
                        className="flex shrink-0 items-center gap-1 rounded border border-stone-600 px-2 py-1 font-mono text-[10px] text-stone-200 transition-colors hover:border-amber-400/70 hover:text-amber-200 disabled:opacity-40"
                        title="Repair costs 4 materials"
                      >
                        <Wrench className="size-3" />
                        4
                      </button>
                    ) : (
                      <span className="shrink-0 font-mono text-[10px] text-stone-600">OK</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* rates summary */}
            <div className="rounded-md border border-stone-800 bg-stone-900/40 p-3">
              <div className="font-mono text-[10px] tracking-widest text-stone-500">
                PRODUCTION / CONSUMPTION — PER SOL
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1.5 text-[11px] sm:grid-cols-2">
                <RateRow label="Power" gen={r.powerGen} use={r.powerUse} unit="U" />
                <RateRow label="Oxygen" gen={r.o2Gen} use={r.o2Use} />
                <RateRow label="Water" gen={r.waterGen} use={r.waterUse} />
                <RateRow label="Food" gen={r.foodGen} use={r.foodUse} />
                <RateRow label="Materials" gen={r.matGen} use={0} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-stone-800 pt-3">
                <div>
                  <div className="flex justify-between font-mono text-[10px] text-stone-400">
                    <span>BATTERY</span>
                    <span>{Math.round(battPct)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-700/70">
                    <div
                      className={`h-full ${g.blackout ? 'bg-red-500' : battPct < 25 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, battPct))}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-stone-400">RADIATION DOSE</div>
                  <div className="mt-0.5 font-mono text-[11px] text-stone-200">
                    {Math.round(g.radiation.dose)} mSv
                    {g.radiation.storm && <span className="ml-1 text-amber-400">STORM</span>}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-stone-400">CREW</div>
                  <div className="mt-0.5 font-mono text-[11px] text-stone-200">
                    {g.population}/{g.popCap} · {Math.round(g.crewHealth)}%
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ============ RESEARCH ============ */}
          <TabsContent value="research" className="mt-3 max-h-[62vh] overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-widest text-stone-500">AVAILABLE RESEARCH</span>
              <span className="flex items-center gap-1.5 font-mono text-sm text-emerald-300">
                <FlaskConical className="size-4" />
                {Math.floor(g.res.research.amount)} pts
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {UPGRADES.map((u) => {
                const owned = g.upgrades.includes(u.id)
                const afford = g.res.research.amount >= u.cost
                return (
                  <div
                    key={u.id}
                    className={`rounded-md border p-3 ${owned ? 'border-emerald-600/50 bg-emerald-950/20' : 'border-stone-800 bg-stone-900/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-stone-100">{u.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-stone-300">{u.cost} pts</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-stone-400">{u.desc}</p>
                    {owned ? (
                      <div className="mt-2 font-mono text-[10px] tracking-widest text-emerald-400">INSTALLED</div>
                    ) : (
                      <button
                        onClick={() => g.buyUpgrade(u.id)}
                        disabled={!afford}
                        className="mt-2 rounded border border-stone-600 px-2 py-1 font-mono text-[10px] tracking-wider text-stone-200 transition-colors hover:border-emerald-500/70 hover:text-emerald-200 disabled:opacity-40"
                      >
                        INSTALL
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </TabsContent>

          {/* ============ LOG ============ */}
          <TabsContent value="log" className="mt-3">
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {g.log.length === 0 && (
                <div className="font-mono text-[11px] text-stone-600">No mission log entries yet.</div>
              )}
              {[...g.log].reverse().map((e) => (
                <div key={e.id} className="flex gap-2 font-mono text-[11px] leading-snug">
                  <span className="shrink-0 text-stone-600">S{e.sol}</span>
                  <span className={LOG_COLOR[e.kind]}>{e.text}</span>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
