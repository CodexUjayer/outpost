'use client'

// ============================================================
// In-game HUD — mission status, resources, toasts, interaction
// prompts, EVA status, event banners and radio traffic.
// Rendered while screen === 'playing'. Root is click-transparent;
// interactive children opt in with pointer-events-auto.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Circle,
  Droplets,
  Info,
  Pause,
  Play,
  Radiation,
  ShieldCheck,
  Thermometer,
  Users,
  Wheat,
  Wind,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useGame } from '@/game/store'
import { BUILDINGS } from '@/game/buildings'
import { phaseName } from '@/game/simulation'
import type { LogEntry } from '@/game/types'

// ---------- small helpers ----------

function clock(t: number): string {
  const mins = Math.max(0, Math.floor(t * 24 * 60))
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

type Tone = 'stone' | 'emerald' | 'amber' | 'red'

const TONE_TEXT: Record<Tone, string> = {
  stone: 'text-stone-200',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  red: 'text-red-400',
}

function Trend({ v, unit = '/sol' }: { v: number; unit?: string }) {
  if (!isFinite(v) || Math.abs(v) < 0.05) {
    return <span className="font-mono text-[10px] leading-none text-stone-600">·</span>
  }
  const up = v > 0
  const a = Math.abs(v)
  return (
    <span className={`font-mono text-[10px] leading-none ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'}
      {a >= 10 ? a.toFixed(0) : a.toFixed(1)}
      {unit}
    </span>
  )
}

function Stat({
  icon: Icon,
  value,
  tone = 'stone',
  trend,
  trendUnit,
  pulse,
}: {
  icon: LucideIcon
  value: string
  tone?: Tone
  trend?: number
  trendUnit?: string
  pulse?: boolean
}) {
  return (
    <div className={`flex items-center gap-1.5 ${pulse ? 'animate-pulse' : ''}`}>
      <Icon className="size-3.5 shrink-0 text-stone-500" strokeWidth={2} />
      <div className="flex flex-col gap-0.5">
        <span className={`whitespace-nowrap font-mono text-xs leading-none ${TONE_TEXT[tone]}`}>{value}</span>
        {trend !== undefined ? <Trend v={trend} unit={trendUnit} /> : null}
      </div>
    </div>
  )
}

function healthTone(p: number): Tone {
  if (p < 40) return 'red'
  if (p < 70) return 'amber'
  return 'emerald'
}

const TOAST_STYLE: Record<LogEntry['kind'], string> = {
  info: 'border-stone-600/70 text-stone-200',
  good: 'border-emerald-500/60 text-emerald-200',
  warn: 'border-amber-500/70 text-amber-200',
  crit: 'border-red-500/70 text-red-200',
}

const TOAST_ICON: Record<LogEntry['kind'], LucideIcon> = {
  info: Info,
  good: CheckCircle2,
  warn: AlertTriangle,
  crit: AlertOctagon,
}

// ---------- HUD ----------

export default function HUD() {
  const g = useGame()

  // Severe event banner — derived from the first unseen severe event,
  // dismissed after 6s (setState only inside the async timer callback).
  const severe = g.activeEvents.find((e) => e.severity === 'severe') ?? null
  const [expiredBanners, setExpiredBanners] = useState<Set<string>>(() => new Set())
  const seenRef = useRef<Set<string>>(new Set())
  const banner =
    severe && !expiredBanners.has(severe.id)
      ? { id: severe.id, title: severe.title, desc: severe.desc }
      : null

  useEffect(() => {
    if (!severe || seenRef.current.has(severe.id)) return
    seenRef.current.add(severe.id)
    const id = severe.id
    setTimeout(() => {
      setExpiredBanners((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
    }, 6000)
  }, [severe])

  // Radio line — derived visibility; fades 7s after the line arrives
  // (radio() always produces a new object, so identity keys the timer).
  const [expiredRadio, setExpiredRadio] = useState<Set<string>>(() => new Set())
  const radioLine = g.radioLine
  const radioOn = radioLine !== null && !expiredRadio.has(radioLine.id)

  useEffect(() => {
    if (!radioLine) return
    const id = radioLine.id
    const t = setTimeout(() => {
      setExpiredRadio((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
    }, 7000)
    return () => clearTimeout(t)
  }, [radioLine])

  const [controlsOpen, setControlsOpen] = useState(true)

  if (g.screen !== 'playing') return null

  const batt = g.battery
  const battPct = batt.cap > 0 ? (batt.charge / batt.cap) * 100 : 0
  const netPower = batt.in - batt.out
  const built = g.buildings.filter((b) => b.built)
  const integrity = built.length > 0 ? built.reduce((s, b) => s + b.health, 0) / built.length : 100
  const suitPct = g.suitO2Cap > 0 ? (g.suitO2 / g.suitO2Cap) * 100 : 0
  const o2 = g.res.oxygen
  const water = g.res.water
  const food = g.res.food
  const place = g.placingType ? BUILDINGS[g.placingType] : null
  const crosshairHidden = g.driving || g.placingType !== null || g.buildMenuOpen || g.colonyPanelOpen

  const suitBadgeTone = suitPct < 20 ? 'text-red-400 animate-pulse' : suitPct < 40 ? 'text-amber-300' : 'text-stone-300'
  const suitBarTone = suitPct < 20 ? 'bg-red-500' : suitPct < 40 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="pointer-events-none fixed inset-0 z-40 select-none text-stone-200">
      {/* ============ top resource bar ============ */}
      <div className="absolute left-1/2 top-2 -translate-x-1/2">
        <div className="flex items-center gap-4 rounded-lg border border-stone-700/60 bg-stone-950/70 px-4 py-2 font-mono backdrop-blur">
          <Stat
            icon={Zap}
            value={`${Math.round(battPct)}%`}
            tone={g.blackout ? 'red' : g.brownout || battPct < 25 ? 'amber' : 'stone'}
            trend={netPower}
            pulse={g.blackout}
          />
          <Stat
            icon={Wind}
            value={`${o2.amount.toFixed(1)}/${o2.cap}`}
            tone={o2.amount < 20 ? 'red' : o2.amount < 40 ? 'amber' : 'stone'}
            trend={g.rates.o2Gen - g.rates.o2Use}
          />
          <Stat
            icon={Droplets}
            value={`${water.amount.toFixed(1)}/${water.cap}`}
            tone={water.amount < 20 ? 'amber' : 'stone'}
            trend={g.rates.waterGen - g.rates.waterUse}
          />
          <Stat
            icon={Wheat}
            value={`${food.amount.toFixed(1)}/${food.cap}`}
            tone={food.amount < 20 ? 'amber' : 'stone'}
            trend={g.rates.foodGen - g.rates.foodUse}
          />
          <Stat
            icon={Radiation}
            value={`${Math.round(g.radiation.dose)} mSv`}
            tone={g.radiation.dose > 350 ? 'red' : g.radiation.dose > 150 ? 'amber' : 'stone'}
            trend={g.radiation.rate}
            trendUnit="/h"
            pulse={g.radiation.storm}
          />
          <Stat icon={Boxes} value={`${Math.floor(g.res.materials.amount)}`} trend={g.rates.matGen} />
          <div className="hidden items-center gap-4 xl:flex">
            <Stat
              icon={Thermometer}
              value={`${Math.round(g.temperature)}°C`}
              tone={g.temperature < 5 ? 'red' : g.temperature < 15 ? 'amber' : 'stone'}
            />
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0 text-stone-500" />
              <div className="flex flex-col gap-0.5">
                <span className="whitespace-nowrap font-mono text-xs leading-none text-stone-200">
                  {g.population}/{g.popCap}
                </span>
                <div className="h-1 w-10 overflow-hidden rounded-full bg-stone-700/80">
                  <div
                    className={`h-full ${g.crewHealth > 60 ? 'bg-emerald-500' : g.crewHealth > 30 ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.max(0, Math.min(100, g.crewHealth))}%` }}
                  />
                </div>
              </div>
            </div>
            <Stat
              icon={ShieldCheck}
              value={`${Math.round(integrity)}%`}
              tone={integrity < 40 ? 'red' : integrity < 70 ? 'amber' : 'stone'}
            />
          </div>
        </div>
      </div>

      {/* ============ top-left: mission panel ============ */}
      <div className="pointer-events-auto absolute left-3 top-3 w-60 rounded-lg border border-stone-700/60 bg-stone-950/70 p-3 backdrop-blur">
        <div className="font-mono text-[11px] leading-tight tracking-widest text-amber-400/90">
          PHASE {g.phase} — {phaseName(g.phase).toUpperCase()}
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-xs text-stone-300">
          <span>SOL {g.sol}</span>
          <span>{clock(g.timeOfDay)}</span>
        </div>
        <div className="mt-2 flex items-center gap-1">
          {[1, 4, 12].map((n) => (
            <button
              key={n}
              onClick={() => g.setTimeScale(n)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                g.timeScale === n
                  ? 'border-stone-300 bg-stone-200 text-stone-950'
                  : 'border-stone-700 bg-stone-900/80 text-stone-400 hover:text-stone-200'
              }`}
            >
              {n}×
            </button>
          ))}
          <button
            onClick={() => g.setPaused(!g.paused)}
            title="Pause"
            className="ml-auto rounded border border-stone-700 bg-stone-900/80 p-1 text-stone-400 hover:text-stone-100"
          >
            {g.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          </button>
        </div>
        {g.objectives.length > 0 && (
          <div className="mt-3 border-t border-stone-800 pt-2">
            <div className="font-mono text-[10px] tracking-widest text-stone-500">OBJECTIVES</div>
            <ul className="mt-1.5 space-y-1">
              {g.objectives.map((o, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-1.5 text-[11px] leading-snug ${o.done ? 'text-emerald-300/80' : 'text-stone-300'}`}
                >
                  {o.done ? (
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 size-3 shrink-0 text-stone-600" />
                  )}
                  <span className={o.done ? 'line-through opacity-70' : ''}>{o.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ============ top-right: toasts ============ */}
      <div className="absolute right-3 top-3 flex w-72 flex-col items-end gap-2">
        <AnimatePresence>
          {g.toasts.map((t) => {
            const Icon = TOAST_ICON[t.kind]
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.18 }}
                className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-stone-950/85 px-3 py-2 backdrop-blur ${TOAST_STYLE[t.kind]}`}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="font-mono text-[11px] leading-snug">{t.text}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* ============ top-center: power + event banners ============ */}
      <div className="absolute left-1/2 top-[68px] flex -translate-x-1/2 flex-col items-center gap-2">
        {g.blackout && (
          <div className="flex animate-pulse items-center gap-2 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-1.5 backdrop-blur">
            <Zap className="size-3.5 text-red-400" />
            <span className="font-mono text-[11px] tracking-widest text-red-300">TOTAL POWER LOSS — BLACKOUT</span>
          </div>
        )}
        {!g.blackout && g.brownout && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/70 bg-stone-950/80 px-3 py-1.5 backdrop-blur">
            <Zap className="size-3.5 text-amber-400" />
            <span className="font-mono text-[11px] tracking-widest text-amber-300">BROWNOUT — BATTERY DEPLETED</span>
          </div>
        )}
        <AnimatePresence>
          {banner && (
            <motion.div
              key={banner.id}
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="w-[400px] max-w-[90vw] rounded-lg border border-red-500/70 bg-stone-950/90 px-4 py-3 shadow-lg shadow-black/50 backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <AlertOctagon className="size-4 shrink-0 text-red-400" />
                <span className="font-mono text-xs font-semibold tracking-widest text-red-300">{banner.title}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] leading-snug text-stone-300">{banner.desc}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============ center: crosshair + interaction ============ */}
      {!crosshairHidden && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="size-1.5 rounded-full bg-stone-100/90 shadow shadow-black/50" />
        </div>
      )}
      {g.interaction && !g.driving && !g.placingType && !g.colonyPanelOpen && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 flex-col items-center gap-2 pt-6">
          {g.interaction.holdTime > 0 && (
            <svg width="40" height="40" viewBox="0 0 40 40" className="drop-shadow-md">
              <circle cx="20" cy="20" r="16" fill="rgba(0,0,0,0.4)" stroke="rgba(214,211,209,0.25)" strokeWidth="2.5" />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 16}
                strokeDashoffset={2 * Math.PI * 16 * (1 - Math.min(1, Math.max(0, g.interactionProgress)))}
                transform="rotate(-90 20 20)"
              />
            </svg>
          )}
          <div className="flex items-center gap-2 rounded-md border border-stone-600/70 bg-stone-950/80 px-3 py-1.5 backdrop-blur">
            <kbd className="rounded border border-stone-500 bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] text-stone-100">E</kbd>
            <span className="font-mono text-[11px] text-stone-200">{g.interaction.label}</span>
          </div>
        </div>
      )}

      {/* ============ bottom-center: placement banner ============ */}
      {place && (
        <div className="pointer-events-auto absolute bottom-28 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-stone-950/85 px-4 py-2.5 backdrop-blur">
            <div>
              <div className="font-mono text-xs tracking-widest text-amber-300">
                PLACING {place.name.toUpperCase()}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-stone-400">
                <Boxes className="mr-1 inline size-3" />
                {place.cost} materials · Left-click confirm · Right-click / Esc cancel
              </div>
              {g.invalidPlacement && (
                <div className="mt-0.5 font-mono text-[10px] text-red-400">{g.invalidPlacement}</div>
              )}
            </div>
            <button
              onClick={g.cancelPlacement}
              title="Cancel placement"
              className="rounded border border-stone-600 bg-stone-900 p-1 text-stone-300 hover:border-red-500/60 hover:text-red-300"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ============ bottom-left: controls hint ============ */}
      <div className="pointer-events-auto absolute bottom-3 left-3 max-w-56 opacity-40 transition-opacity hover:opacity-100">
        <button
          onClick={() => setControlsOpen((v) => !v)}
          className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-stone-300"
        >
          CONTROLS
          <ChevronDown className={`size-3 transition-transform ${controlsOpen ? '' : '-rotate-90'}`} />
        </button>
        {controlsOpen && (
          <div className="mt-1 space-y-0.5 font-mono text-[10px] leading-relaxed text-stone-400">
            <div>WASD — move · SHIFT — run</div>
            <div>SPACE — jump · E — interact</div>
            <div>B — build · TAB — colony panel</div>
            <div>R — rover · T — time · ESC — pause</div>
            <div className="text-amber-200/70">DRIVING: WASD — drive · E — exit rover</div>
          </div>
        )}
      </div>

      {/* ============ bottom-center: radio line ============ */}
      <div className="absolute bottom-20 left-1/2 w-full max-w-xl -translate-x-1/2 px-4 text-center">
        <AnimatePresence>
          {radioOn && g.radioLine && (
            <motion.p
              key={g.radioLine.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="font-mono text-xs tracking-wide text-stone-300/75 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
            >
              » {g.radioLine.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ============ bottom-right: EVA status + panel shortcuts ============ */}
      <div className={`absolute right-3 flex flex-col items-end gap-2 ${place || g.construction ? 'bottom-16' : 'bottom-3'}`}>
        {g.inside === null ? (
          <div className="rounded-lg border border-stone-700/60 bg-stone-950/70 px-3 py-2 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <span className={`font-mono text-[10px] tracking-widest ${suitBadgeTone}`}>EVA</span>
              <span className="font-mono text-[10px] text-stone-400">
                SUIT O₂ {Math.round(suitPct)}%
              </span>
            </div>
            <div
              className={`mt-1 h-1.5 w-44 overflow-hidden rounded-full bg-stone-700/70 ${suitPct < 20 ? 'animate-pulse' : ''}`}
            >
              <div className={`h-full ${suitBarTone}`} style={{ width: `${Math.max(0, Math.min(100, suitPct))}%` }} />
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-emerald-500/50 bg-emerald-950/30 px-3 py-1.5 backdrop-blur">
            <span className="font-mono text-[10px] tracking-widest text-emerald-300">PRESSURIZED</span>
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            onClick={() => g.toggleColonyPanel()}
            className={`rounded border px-2 py-1 font-mono text-[10px] tracking-wider transition-colors ${
              g.colonyPanelOpen
                ? 'border-stone-300 bg-stone-200 text-stone-950'
                : 'border-stone-700/70 bg-stone-950/70 text-stone-400 backdrop-blur hover:text-stone-100'
            }`}
          >
            COLONY [TAB]
          </button>
          <button
            onClick={() => g.toggleBuildMenu()}
            className={`rounded border px-2 py-1 font-mono text-[10px] tracking-wider transition-colors ${
              g.buildMenuOpen
                ? 'border-amber-400 bg-amber-400 text-stone-950'
                : 'border-stone-700/70 bg-stone-950/70 text-stone-400 backdrop-blur hover:text-stone-100'
            }`}
          >
            BUILD [B]
          </button>
        </div>
      </div>
    </div>
  )
}
