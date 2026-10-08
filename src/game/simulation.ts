// ============================================================
// Colony simulation — the engineering brain.
// Called at ~10 Hz with real-time delta (seconds).
// 1 sol = 240 game-seconds. All rates are defined per sol.
// ============================================================
import type { GameState, BuildingInstance, Objective, Rates, Planet, LogEntry } from './types'
import { PLANETS } from './types'
import { BUILDINGS } from './buildings'
import { maybeSpawnEvent, tickEvents, EventDraft } from './events'

// ---------- helpers ----------
export function sunFactor(planet: Planet, timeOfDay: number): number {
  const { dayFrac } = PLANETS[planet]
  const dayStart = 0.02
  if (timeOfDay < dayStart || timeOfDay > dayStart + dayFrac) return 0
  const t = (timeOfDay - dayStart) / dayFrac
  return Math.sin(t * Math.PI) ** 0.55
}

export function phaseName(phase: number): string {
  return [
    '', 'Touchdown & Survival', 'Shelter', 'Power & Water',
    'Food Production', 'Crew & Research', 'Industrial Base', 'Self-Sustaining Colony',
  ][phase] ?? ''
}

const PER_SOL = 1 / 240

function computeRates(
  buildings: BuildingInstance[],
  population: number,
  opts: { blackout: boolean; brownout: boolean; dustFactor: number; cropFactor: number; upgrades: string[]; planet: Planet; timeOfDay: number },
): Rates {
  const r: Rates = { powerGen: 2, powerUse: 0, o2Gen: 0, o2Use: 0, waterGen: 0, waterUse: 0, foodGen: 0, foodUse: 0, matGen: 0 }
  const solarEff = opts.upgrades.includes('solar_eff') ? 1.3 : 1
  for (const b of buildings) {
    if (!b.built) continue
    const def = BUILDINGS[b.type]
    if (!def) continue
    const forcedOff =
      (opts.blackout && b.type !== 'habitat') ||
      (opts.brownout && ['greenhouse', 'lab', 'refinery', 'extractor', 'comms'].includes(b.type))
    const online = b.online && !forcedOff
    if (b.type === 'solar') {
      r.powerGen += 14 * PLANETS[opts.planet].solarPeak * solarEff * (b.health / 100) * opts.dustFactor * (online ? 1 : 0.15)
      continue
    }
    if (!online) continue
    r.powerUse += def.powerUse
    if (b.type === 'extractor') r.waterGen += (def.rate?.waterGen ?? 0) * (0.35 + (b.health / 100) * 0.65)
    if (b.type === 'oxygen') r.o2Gen += def.rate?.o2Gen ?? 0
    if (b.type === 'greenhouse') {
      r.foodGen += (def.rate?.foodGen ?? 0) * (opts.upgrades.includes('hydro_yield') ? 1.5 : 1) * opts.cropFactor
    }
    if (b.type === 'refinery') r.matGen += def.rate?.matGen ?? 0
  }
  // crew consumption
  r.o2Use = population * 4
  r.waterUse += population * 2.5 * (opts.upgrades.includes('water_reclaim') ? 0.65 : 1)
  r.foodUse = population * 2
  return r
}

function currentPowerGen(
  buildings: BuildingInstance[],
  planet: Planet,
  timeOfDay: number,
  dustFactor: number,
  blackout: boolean,
  upgrades: string[],
): number {
  const sun = sunFactor(planet, timeOfDay)
  const solarEff = upgrades.includes('solar_eff') ? 1.3 : 1
  let gen = 2 // lander RTG baseline
  for (const b of buildings) {
    if (!b.built || b.type !== 'solar') continue
    gen += 14 * PLANETS[planet].solarPeak * solarEff * (b.health / 100) * dustFactor * (blackout ? 0 : 1) * sun
  }
  return gen
}

function currentPowerUse(buildings: BuildingInstance[], brownout: boolean, blackout: boolean): number {
  let use = 1.5 // lander life support
  for (const b of buildings) {
    if (!b.built) continue
    const def = BUILDINGS[b.type]
    if (!def || b.type === 'solar' || b.type === 'battery') continue
    const forcedOff =
      (blackout && b.type !== 'habitat') ||
      (brownout && ['greenhouse', 'lab', 'refinery', 'extractor', 'comms'].includes(b.type))
    if (!b.online || forcedOff) continue
    use += def.powerUse
  }
  return use
}

function makeObjectives(phase: number, buildings: BuildingInstance[], sol: number, population: number, temperature: number, powerGenPeak: number): Objective[] {
  const has = (t: string) => buildings.some((b) => b.type === t && b.built)
  const on = (t: string) => buildings.some((b) => b.type === t && b.built && b.online)
  switch (phase) {
    case 1:
      return [
        { text: 'Deploy the spare solar array from the lander cargo', done: has('solar') },
        { text: 'Survive until Sol 2', done: sol >= 2 },
      ]
    case 2:
      return [
        { text: 'Construct a Crew Habitat (30 materials)', done: has('habitat') },
        { text: 'Build a battery bank to survive the night', done: has('battery') },
      ]
    case 3:
      return [
        { text: 'Bring the Ice Extractor online', done: on('extractor') },
        { text: 'Bring the O₂ Generator online', done: on('oxygen') },
      ]
    case 4:
      return [
        { text: 'Construct a Greenhouse', done: has('greenhouse') },
        { text: 'Keep the greenhouse heated above 5°C', done: has('greenhouse') && temperature > 8 },
      ]
    case 5:
      return [
        { text: 'Build the Research Lab', done: has('lab') },
        { text: 'Grow the colony to 4 crew', done: population >= 4 },
      ]
    case 6:
      return [
        { text: 'Build the ISRU Refinery', done: has('refinery') },
        { text: 'Build the Comms Tower', done: has('comms') },
        { text: 'Reach 60+ peak power generation', done: powerGenPeak >= 60 },
      ]
    case 7:
      return [
        { text: 'Grow the colony to 8 crew', done: population >= 8 },
        { text: 'Remain self-sufficient for 2 consecutive sols', done: false },
      ]
    default:
      return []
  }
}

// ---------- persistent timers ----------
const timers = {
  eventAccum: 30, // first event after ~30s of play
  supply: 0,
  arrival: 0,
  arrivalCooldown: 0,
}

export function resetTimers(): void {
  timers.eventAccum = 30
  timers.supply = 0
  timers.arrival = 0
  timers.arrivalCooldown = 0
}

export interface SimResult {
  state: Partial<GameState>
  notify: { text: string; kind: LogEntry['kind'] }[]
  radio: string[]
}

const COLONIST_NAMES = ['R. Watanabe', 'A. Okafor', 'M. Reyes', 'S. Lindqvist', 'J. Okonkwo', 'L. Moreau', 'D. Petrov', 'K. Sharma']

// ---------- main tick ----------
export function runSimulation(st: GameState, dt: number): SimResult {
  const planet = st.planet
  const cfg = PLANETS[planet]
  const notify: SimResult['notify'] = []
  const radio: string[] = []
  const logs: LogEntry[] = []

  // ---- working drafts ----
  const res: Record<string, { amount: number; cap: number }> = {}
  for (const k of Object.keys(st.res)) res[k] = { ...st.res[k as keyof typeof st.res] }
  const buildings: BuildingInstance[] = st.buildings.map((b) => ({ ...b }))
  const activeEvents = st.activeEvents.map((e) => ({ ...e, data: { ...e.data } }))
  const draft: EventDraft = {
    buildings,
    activeEvents,
    res,
    eventsSurvived: st.eventsSurvived,
    notifiedThisTick: notify,
    radio,
  }

  // ---- spawn events ----
  timers.eventAccum += dt
  if (timers.eventAccum > 42 + Math.random() * 55) {
    timers.eventAccum = 0
    maybeSpawnEvent(draft, planet, st.phase, 1, { t: 1 })
  }

  // ---- derive event flags ----
  const dustStorm = activeEvents.find((e) => e.type === 'dust_storm')
  const dustFactor = dustStorm ? (dustStorm.data.powerFactor ?? 0.35) : 1
  const solarStorm = activeEvents.find((e) => e.type === 'solar_storm')
  const commsDown = activeEvents.some((e) => e.type === 'comm_blackout')
  const cropFail = activeEvents.some((e) => e.type === 'crop_failure')
  const crewIll = activeEvents.some((e) => e.type === 'crew_illness')
  const leakActive = activeEvents.some((e) => e.type === 'oxygen_leak')

  // ---- power ----
  const brownout = st.battery.charge <= 0.01
  const blackout = st.battery.charge <= -8
  const rates = computeRates(buildings, st.population, {
    blackout, brownout, dustFactor,
    cropFactor: cropFail ? 0.3 : 1,
    upgrades: st.upgrades, planet, timeOfDay: st.timeOfDay,
  })
  const gen = currentPowerGen(buildings, planet, st.timeOfDay, dustFactor, blackout, st.upgrades)
  const use = currentPowerUse(buildings, brownout, blackout)
  rates.powerGen = gen
  rates.powerUse = use

  const battery = { ...st.battery }
  const net = gen - use
  if (net >= 0) {
    battery.charge = Math.min(battery.cap, battery.charge + net * dt * PER_SOL)
    battery.in = net
    battery.out = 0
  } else {
    battery.charge = Math.max(-10, battery.charge + net * dt * PER_SOL)
    battery.in = 0
    battery.out = -net
  }
  if (brownout && !st.brownout) {
    notify.push({ text: 'BROWNOUT — battery empty. Non-critical systems shut down.', kind: 'crit' })
    radio.push('Mission Control: You are browning out. Let the arrays recharge before doing anything else.')
  }
  if (blackout && !st.blackout) {
    notify.push({ text: 'BLACKOUT — total power loss. O₂ production halted!', kind: 'crit' })
  }
  // power surge event effect (instant)
  const surge = activeEvents.find((e) => e.type === 'power_surge' && e.t < 0.1)
  if (surge) battery.charge = Math.max(-9, battery.charge - 15)

  // ---- electrolysis water limitation ----
  let o2WaterNeed = 0
  for (const b of buildings) {
    if (b.built && b.online && b.type === 'oxygen' && !blackout) o2WaterNeed += BUILDINGS.oxygen.waterUse ?? 0
  }
  const o2WaterRatio = o2WaterNeed > 0 ? Math.min(1, res.water.amount / Math.max(0.05, o2WaterNeed * dt * PER_SOL)) : 1
  if (o2WaterRatio < 1 && o2WaterNeed > 0 && Math.random() < dt * 0.05) {
    notify.push({ text: 'O₂ generator starved of water — output reduced', kind: 'warn' })
  }
  rates.o2Gen *= blackout ? 0 : o2WaterRatio
  const o2WaterUse = Math.min(res.water.amount, o2WaterNeed * dt * PER_SOL)

  // ---- resources integration ----
  const solDt = dt * PER_SOL
  res.oxygen.amount = Math.max(0, res.oxygen.amount + (rates.o2Gen - rates.o2Use) * solDt - (leakActive ? 3 * solDt : 0))
  res.water.amount = Math.max(0, res.water.amount + (rates.waterGen - rates.waterUse) * solDt - o2WaterUse)
  res.food.amount = Math.max(0, res.food.amount + (rates.foodGen - rates.foodUse) * solDt)
  res.materials.amount = Math.min(res.materials.cap, res.materials.amount + rates.matGen * solDt)

  // research from lab
  const labOnline = buildings.some((b) => b.built && b.online && b.type === 'lab') && !brownout
  res.research.amount = Math.min(res.research.cap, res.research.amount + (labOnline ? 1 : 0) * solDt)

  // ---- temperature ----
  const sun = sunFactor(planet, st.timeOfDay)
  const outsideTemp = planet === 'moon'
    ? (sun > 0.05 ? 40 + sun * 60 : -130)
    : (-8 + sun * 12 - (dustStorm ? 8 : 0))
  // the lander's emergency life support keeps the colony warm unless total blackout
  const targetTemp = blackout
    ? Math.max(outsideTemp * 0.55, -60)
    : brownout
      ? 15
      : 21
  const temperature = st.temperature + (targetTemp - st.temperature) * Math.min(1, dt * (blackout ? 0.02 : 0.25))
  if (temperature < 3 && !blackout && Math.random() < dt * 0.03) {
    notify.push({ text: 'Habitat heaters struggling — check power budget', kind: 'warn' })
  }

  // ---- radiation ----
  const inside = st.inside !== null
  const inShelter = st.inside ? buildings.some((b) => b.id === st.inside && b.type === 'shelter') : false
  const inHab = st.inside ? buildings.some((b) => b.id === st.inside && (b.type === 'habitat' || b.type === 'greenhouse')) : false
  let radRate = cfg.baseRad
  if (inside) radRate = inShelter ? cfg.baseRad * 0.05 : cfg.baseRad * (inHab ? 0.08 : 0.15)
  if (solarStorm) radRate *= inside ? (inShelter ? 0.15 : 2.2) : 25
  if (st.upgrades.includes('rad_shield') && inside) radRate *= 0.6
  const dose = st.radiation.dose + radRate * (dt / 10) // 24 game-hours per sol of 240s
  if (dose > 150 && st.radiation.dose <= 150) notify.push({ text: 'Radiation dose at 150 mSv — shelter during storms', kind: 'warn' })
  if (dose > 350 && st.radiation.dose <= 350) notify.push({ text: 'Radiation dose CRITICAL — crew health at risk', kind: 'crit' })

  // ---- suit oxygen ----
  let suitO2 = st.suitO2
  let playerVitals = st.playerVitals
  let crewHealth = st.crewHealth
  if (inside) {
    suitO2 = Math.min(st.suitO2Cap, suitO2 + 14 * dt)
  } else {
    suitO2 = Math.max(0, suitO2 - 0.32 * dt)
    if (suitO2 <= 0) playerVitals -= 4.5 * dt
    else if (suitO2 < 25 && Math.random() < dt * 0.08) notify.push({ text: 'Suit O₂ low — return to a habitat!', kind: 'warn' })
  }

  // ---- survival stress ----
  const o2out = res.oxygen.amount <= 0.01
  const foodout = res.food.amount <= 0.01
  const waterout = res.water.amount <= 0.01
  if (o2out) {
    crewHealth -= 2.2 * dt
    if (inside) playerVitals -= 2.2 * dt
  }
  if (waterout) crewHealth -= 1.2 * dt
  if (foodout) crewHealth -= 0.7 * dt
  if (temperature < 2) { crewHealth -= 0.8 * dt; playerVitals -= 0.8 * dt }
  if (crewIll) crewHealth -= 1.5 * dt
  if (dose > 400) crewHealth -= 0.4 * dt
  if (!o2out && !waterout && !foodout && temperature > 5) {
    crewHealth = Math.min(100, crewHealth + 0.9 * dt)
    playerVitals = Math.min(100, playerVitals + (inside ? 1.1 : 0.5) * dt)
  }
  playerVitals = Math.min(100, playerVitals)

  // ---- tick events (durations, resolutions) ----
  tickEvents(draft, dt, 0.1)

  // ---- supply missions (comms accelerates; baseline drops still arrive) ----
  const commsOnline = buildings.some((b) => b.built && b.online && b.type === 'comms') && !commsDown && !brownout
  timers.supply += dt
  const supplyInterval = commsOnline ? 380 : 480
  if (timers.supply > supplyInterval) {
    timers.supply = 0
    const mats = commsOnline ? 18 : 14
    res.materials.amount = Math.min(res.materials.cap, res.materials.amount + mats)
    res.water.amount = Math.min(res.water.cap, res.water.amount + 10)
    notify.push({ text: `📦 Resupply capsule intercepted: +${mats} materials, +10 water`, kind: 'good' })
    radio.push('Mission Control: Resupply away — catch it while it is fresh.')
  }

  // ---- colonist arrivals ----
  const popCap = 2 + buildings.filter((b) => b.built && b.type === 'habitat').length * 3
  const o2days = rates.o2Use > rates.o2Gen ? res.oxygen.amount / Math.max(0.1, rates.o2Use - rates.o2Gen) : 99
  const fooddays = rates.foodUse > rates.foodGen ? res.food.amount / Math.max(0.1, rates.foodUse - rates.foodGen) : 99
  timers.arrivalCooldown = Math.max(0, timers.arrivalCooldown - dt)
  let population = st.population
  timers.arrival += dt
  if (st.phase >= 3 && population < popCap && o2days > 8 && fooddays > 8 && timers.arrival > 95 && timers.arrivalCooldown <= 0) {
    timers.arrival = 0
    timers.arrivalCooldown = 60
    population += 1
    const name = COLONIST_NAMES[(population - 2) % COLONIST_NAMES.length]
    radio.push(`Crew transfer: ${name} docking now. Welcome to the neighborhood.`)
    notify.push({ text: `🧑‍🚀 New colonist arrived: ${name} (population ${population})`, kind: 'good' })
  }

  // ---- time & sol ----
  let timeOfDay = st.timeOfDay + dt / 240
  let sol = st.sol
  let dayChanged = false
  if (timeOfDay >= 1) {
    timeOfDay -= 1
    sol += 1
    dayChanged = true
    if (sol === 2) radio.push('Mission Control: You made it through your first sol. Now build something that lasts.')
    if (sol % 3 === 0) logs.push({ id: `sol-${sol}-${Date.now()}`, sol, text: `Sol ${sol}: keep the arrays clean and the crew fed.`, kind: 'info' })
  }

  // ---- phase progression ----
  const objectives = makeObjectives(st.phase, buildings, sol, population, temperature, rates.powerGen)
  let phase = st.phase
  const allDone = objectives.length > 0 && objectives.every((o) => o.done)
  if (allDone && phase < 7) {
    phase += 1
    notify.push({ text: `✔ PHASE ${phase} — ${phaseName(phase)}`, kind: 'good' })
    radio.push([
      '', '',
      'Mission Control: Shelter first. Power second. Everything else is conversation.',
      "Mission Control: Water and oxygen are the colony's heartbeat. Protect both.",
      'Mission Control: If you cannot feed yourselves, you are still on a camping trip.',
      'Mission Control: Science keeps the colony ahead of its problems.',
      'Mission Control: Industry — now we are talking about a settlement, not a camp.',
      'Mission Control: Final stretch — prove this colony can stand on its own.',
    ][phase] ?? '')
  }

  // ---- self-sufficiency & victory ----
  let selfSufficientStreak = st.selfSufficientStreak
  const selfSufficient =
    population >= 8 &&
    rates.o2Gen >= rates.o2Use &&
    rates.waterGen >= rates.waterUse &&
    rates.foodGen >= rates.foodUse &&
    gen >= use
  if (selfSufficient) selfSufficientStreak += dt
  else selfSufficientStreak = 0

  // ---- assemble result ----
  const state: Partial<GameState> = {
    res: res as GameState['res'],
    buildings,
    activeEvents,
    battery,
    rates,
    brownout,
    blackout,
    temperature,
    outsideTemp,
    radiation: { dose, rate: radRate, storm: !!solarStorm },
    suitO2,
    playerVitals,
    crewHealth,
    timeOfDay,
    sol,
    phase,
    population,
    popCap,
    eventsSurvived: draft.eventsSurvived,
    selfSufficientStreak,
    objectives,
  }
  if (logs.length) state.log = [...st.log.slice(-120), ...logs]
  if (dayChanged && sol >= 2) void dayChanged

  // ---- failure / victory ----
  let terminal: Partial<GameState> | null = null
  if (playerVitals <= 0) {
    terminal = {
      screen: 'gameover',
      failureReason: suitO2 <= 0
        ? 'Your suit ran out of oxygen during EVA. Always watch the suit O₂ gauge before exploring.'
        : res.oxygen.amount <= 0.01
          ? 'Colony oxygen reserves hit zero and life support could not recover. Oxygen is the first budget of survival.'
          : 'Your vitals failed. The frontier does not forgive neglect.',
      driving: false,
    }
  } else if (crewHealth <= 0) {
    terminal = {
      screen: 'gameover',
      failureReason: 'The crew did not survive — life support, food, heat or radiation management failed for too long.',
      driving: false,
    }
  } else if (dose >= 700) {
    terminal = {
      screen: 'gameover',
      failureReason: 'Cumulative radiation dose exceeded survivable limits (700 mSv). Shelter during storms and shield habitats.',
      driving: false,
    }
  } else if (phase >= 7 && selfSufficientStreak >= 480) {
    terminal = {
      screen: 'victory',
      victoryStats: { sols: sol, pop: population, eventsSurvived: draft.eventsSurvived },
      driving: false,
    }
  }
  if (terminal) {
    return { state: { ...state, ...terminal }, notify, radio }
  }

  return { state, notify, radio }
}
