// Dynamic event system — spawns and ticks world events.
// Functions mutate a working draft owned by simulation.ts.
import type { ActiveEvent, BuildingInstance, EventType, Planet, ResourceState } from './types'
import { BUILDINGS } from './buildings'
import { nextId } from './store'
import { heightAt } from './terrain'

export interface EventDraft {
  buildings: BuildingInstance[]
  activeEvents: ActiveEvent[]
  res: Record<string, ResourceState>
  eventsSurvived: number
  notifiedThisTick: { text: string; kind: 'info' | 'good' | 'warn' | 'crit' }[]
  radio: string[]
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

function eligibleTargets(buildings: BuildingInstance[], kinds: string[]): BuildingInstance[] {
  return buildings.filter((b) => b.built && kinds.includes(b.type))
}

export function eventWeights(planet: Planet, phase: number): Partial<Record<EventType, number>> {
  const w: Partial<Record<EventType, number>> = {
    equipment_failure: 10,
    panel_degradation: planet === 'mars' ? 9 : 5,
    oxygen_leak: 8,
    power_surge: 5,
    solar_storm: planet === 'moon' ? 10 : 6,
    dust_storm: planet === 'mars' ? 14 : 0,
    meteor: planet === 'moon' ? 7 : 3,
    crop_failure: 0,
    water_issue: 6,
    comm_blackout: 5,
    crew_illness: 0,
  }
  if (phase >= 4) w.crop_failure = 7
  if (phase >= 5) w.crew_illness = 4
  return w
}

export function maybeSpawnEvent(draft: EventDraft, planet: Planet, phase: number, dt: number, timer: { t: number }): void {
  timer.t += dt
  if (timer.t < 40) return
  // reset timer
  timer.t = rand(-25, 0)
  const weights = eventWeights(planet, phase)
  const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0)
  let roll = Math.random() * total
  let chosen: EventType = 'equipment_failure'
  for (const [k, v] of Object.entries(weights)) {
    roll -= v ?? 0
    if (roll <= 0) {
      chosen = k as EventType
      break
    }
  }
  // avoid stacking too many of same type
  const sameCount = draft.activeEvents.filter((e) => e.type === chosen).length
  if (sameCount >= 2) return
  spawnEvent(draft, chosen)
}

export function spawnEvent(draft: EventDraft, type: EventType): void {
  const ev = makeEvent(type, draft)
  if (!ev) return
  draft.activeEvents.push(ev)
  draft.notifiedThisTick.push({ text: `${ev.title} — ${ev.desc}`, kind: ev.severity === 'severe' ? 'crit' : ev.severity === 'moderate' ? 'warn' : 'info' })
  if (ev.severity === 'severe' || ev.severity === 'moderate') {
    draft.radio.push(ev.type === 'solar_storm'
      ? 'Mission Control: Solar particle event detected. Get inside — that is not a request.'
      : ev.type === 'dust_storm'
        ? 'Weather sat: Regional dust storm approaching. Expect heavy power loss.'
        : 'Mission Control: We are seeing an anomaly on telemetry. Check your systems.')
  }
}

function makeEvent(type: EventType, draft: EventDraft): ActiveEvent | null {
  switch (type) {
    case 'solar_storm':
      return {
        id: nextId(), type, title: '☢ Solar Particle Event',
        desc: 'Radiation spiking. Get inside a pressurized habitat or the storm shelter.',
        severity: 'severe', t: 0, dur: rand(55, 100), data: {},
      }
    case 'dust_storm':
      return {
        id: nextId(), type, title: '🌪 Dust Storm',
        desc: 'Airborne dust is cutting solar output by ~65%. Panels may foul.',
        severity: 'moderate', t: 0, dur: rand(70, 130), data: { powerFactor: 0.35 },
      }
    case 'meteor': {
      const target = pick(eligibleTargets(draft.buildings, ['solar', 'battery', 'extractor', 'greenhouse', 'depot', 'oxygen']))
      if (!target) return null
      return {
        id: nextId(), type, title: '☄ Micrometeorite Impact',
        desc: `A micrometeoroid struck the ${BUILDINGS[target.type]?.name ?? 'colony'}. Inspect and repair it.`,
        severity: 'moderate', t: 0, dur: -1, data: { targetId: target.id },
      }
    }
    case 'equipment_failure': {
      const target = pick(eligibleTargets(draft.buildings, ['extractor', 'oxygen', 'greenhouse', 'lab', 'refinery', 'battery', 'comms']))
      if (!target) return null
      return {
        id: nextId(), type, title: '⚙ Equipment Failure',
        desc: `${BUILDINGS[target.type].name} fault detected — power cycle the damaged unit and repair it.`,
        severity: 'moderate', t: 0, dur: -1, data: { targetId: target.id },
      }
    }
    case 'panel_degradation': {
      const panels = eligibleTargets(draft.buildings, ['solar'])
      if (!panels.length) return null
      const target = pick(panels)
      return {
        id: nextId(), type, title: '🛡 Panel Fouling',
        desc: 'Dust and micrometeoroids have degraded a solar array. Output reduced until cleaned/repaired.',
        severity: 'minor', t: 0, dur: -1, data: { targetId: target.id },
      }
    }
    case 'oxygen_leak': {
      const target = pick(eligibleTargets(draft.buildings, ['habitat', 'oxygen', 'depot', 'greenhouse']))
      if (!target) return null
      const a = rand(0, Math.PI * 2)
      const r = BUILDINGS[target.type].footprint * 0.75
      const leakPos: [number, number, number] = [
        target.pos[0] + Math.cos(a) * r,
        target.pos[1] + 1.1,
        target.pos[2] + Math.sin(a) * r,
      ]
      return {
        id: nextId(), type, title: '💨 Oxygen Leak',
        desc: 'Pressure vessel leak detected! O₂ is escaping. Follow the hiss and weld a patch.',
        severity: 'severe', t: 0, dur: -1, data: { targetId: target.id, leakPos, leakId: nextId() },
      }
    }
    case 'crop_failure':
      return {
        id: nextId(), type, title: '🌾 Crop Blight',
        desc: 'Root-zone pathogens in the hydroponics racks — food output severely reduced.',
        severity: 'moderate', t: 0, dur: rand(90, 140), data: {},
      }
    case 'water_issue': {
      const ext = eligibleTargets(draft.buildings, ['extractor'])[0]
      if (!ext) return null
      return {
        id: nextId(), type, title: '🧊 Borehole Clog',
        desc: 'Ice extractor intake is clogged with regolith. Output dropping — repair it.',
        severity: 'moderate', t: 0, dur: -1, data: { targetId: ext.id },
      }
    }
    case 'power_surge':
      return {
        id: nextId(), type, title: '⚡ Power Surge',
        desc: 'A charge controller fault dumped part of the battery bank.',
        severity: 'minor', t: 0, dur: 2, data: {},
      }
    case 'comm_blackout':
      return {
        id: nextId(), type, title: '📡 Comms Blackout',
        desc: 'High-gain antenna lost Earth lock. Resupplies and warnings suspended.',
        severity: 'minor', t: 0, dur: rand(50, 90), data: {},
      }
    case 'crew_illness':
      return {
        id: nextId(), type, title: '🤒 Crew Illness',
        desc: 'Elevated radiation dose is affecting the crew. Health declining.',
        severity: 'moderate', t: 0, dur: 70, data: {},
      }
  }
  return null
}

/** Apply ongoing event effects. Returns extra state mutations via draft. */
export function tickEvents(draft: EventDraft, dt: number, gameHoursPerSecond: number): void {
  const keep: ActiveEvent[] = []
  for (const ev of draft.activeEvents) {
    ev.t += dt
    switch (ev.type) {
      case 'oxygen_leak':
        // drain O2 (3/sol)
        draft.res.oxygen.amount = Math.max(0, draft.res.oxygen.amount - 3 * (dt / 240))
        break
      case 'power_surge':
        draft.res.oxygen.amount = draft.res.oxygen.amount // no-op, handled at spawn in sim
        break
      case 'solar_storm':
      case 'dust_storm':
      case 'crop_failure':
      case 'comm_blackout':
      case 'crew_illness':
        break
      case 'meteor':
      case 'equipment_failure':
      case 'panel_degradation':
      case 'water_issue':
        // resolved by repairing the target
        break
    }
    // instant/repair-type events: mark survived once repaired
    if (ev.dur === -1) {
      if (['equipment_failure', 'meteor', 'panel_degradation', 'water_issue'].includes(ev.type)) {
        const target = draft.buildings.find((b) => b.id === ev.data.targetId)
        if (!target || target.health >= 85) {
          draft.eventsSurvived++
          draft.notifiedThisTick.push({ text: `${ev.title.replace(/^\S+\s/, '')} resolved`, kind: 'good' })
          continue // drop event
        }
      }
      if (ev.type === 'oxygen_leak') {
        // leak patch handled by patchLeak; keep until patched
      }
      keep.push(ev)
      continue
    }
    if (ev.t < ev.dur) {
      keep.push(ev)
      if (ev.dur - ev.t <= dt) {
        draft.eventsSurvived++
        if (ev.type === 'dust_storm') {
          // fouling chance at storm end
          const panels = eligibleTargets(draft.buildings, ['solar'])
          if (panels.length && Math.random() < 0.5) {
            const target = pick(panels)
            target.health = Math.max(15, target.health - rand(10, 25))
            draft.notifiedThisTick.push({ text: 'Dust storm fouled a solar array — output reduced', kind: 'warn' })
          }
        }
        if (ev.type === 'crew_illness') {
          draft.notifiedThisTick.push({ text: 'Crew recovered from illness', kind: 'good' })
        }
      }
    }
  }
  draft.activeEvents = keep
}

/** Instant application of one-shot events (meteor damage etc.) */
export function applyInstantEffects(draft: EventDraft): void {
  for (const ev of draft.activeEvents) {
    if (ev.t === 0 || ev.t < 0.05) {
      // just spawned
      switch (ev.type) {
        case 'meteor':
        case 'equipment_failure':
        case 'panel_degradation':
        case 'water_issue': {
          const target = draft.buildings.find((b) => b.id === ev.data.targetId)
          if (target) {
            const dmg = ev.type === 'meteor' ? rand(20, 38) : ev.type === 'water_issue' ? 25 : rand(18, 32)
            target.health = Math.max(8, target.health - dmg)
            if (target.health < 40) target.online = false
          }
          break
        }
        case 'power_surge': {
          if (draft.res.oxygen) {
            // battery handled in sim via flag
          }
          break
        }
      }
    }
  }
}
