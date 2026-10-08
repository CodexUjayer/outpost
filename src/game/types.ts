// ============================================================
// Core game types — Off-World Colony STEM Game
// ============================================================

export type Planet = 'moon' | 'mars'

export type Screen = 'menu' | 'landing' | 'cutscene' | 'playing' | 'gameover' | 'victory'

export type BuildingType =
  | 'solar'
  | 'battery'
  | 'habitat'
  | 'greenhouse'
  | 'extractor'
  | 'oxygen'
  | 'lab'
  | 'refinery'
  | 'comms'
  | 'shelter'
  | 'depot'

export type ResourceKey = 'oxygen' | 'water' | 'food' | 'materials' | 'research'

export interface ResourceState {
  amount: number
  cap: number
}

export interface BuildingInstance {
  id: string
  type: BuildingType
  pos: [number, number, number]
  rot: number
  health: number // 0..100
  online: boolean
  doorOpen: boolean
  built: boolean // construction cinematic finished
}

export type EventType =
  | 'solar_storm'
  | 'dust_storm'
  | 'equipment_failure'
  | 'meteor'
  | 'oxygen_leak'
  | 'crop_failure'
  | 'water_issue'
  | 'power_surge'
  | 'supply_delay'
  | 'comm_blackout'
  | 'panel_degradation'
  | 'crew_illness'

export type Severity = 'minor' | 'moderate' | 'severe'

export interface ActiveEvent {
  id: string
  type: EventType
  title: string
  desc: string
  severity: Severity
  t: number // elapsed seconds (game time)
  dur: number // total duration (game seconds); -1 = until condition met
  data: {
    targetId?: string
    leakPos?: [number, number, number]
    leakId?: string
    powerFactor?: number
    radFactor?: number
  }
}

export interface LogEntry {
  id: string
  sol: number
  text: string
  kind: 'info' | 'good' | 'warn' | 'crit'
}

export interface Rates {
  powerGen: number // per sol (peak)
  powerUse: number // per sol
  o2Gen: number
  o2Use: number
  waterGen: number
  waterUse: number
  foodGen: number
  foodUse: number
  matGen: number
}

export type InteractionKind =
  | 'door'
  | 'repair'
  | 'leak'
  | 'console'
  | 'cargo_solar'
  | 'rover'
  | 'shelter'
  | 'ship_exit'
  | 'ship_info'

export interface InteractionTarget {
  id: string
  label: string
  kind: InteractionKind
  buildingId: string
  pos: [number, number, number]
  holdTime: number // seconds to hold E; 0 = instant
}

export interface Objective {
  text: string
  done: boolean

}

export interface ConstructionState {
  type: BuildingType
  pos: [number, number, number]
  rot: number
  t: number // elapsed real seconds
  dur: number
}

export interface PlanetConfig {
  name: string
  gravity: number // m/s^2
  solarPeak: number // multiplier on panel output
  dayFrac: number // fraction of sol with sun up
  skyTop: string
  skyHorizon: string
  fogColor: string
  fogDensity: number
  groundColor: string
  groundColor2: string
  rockColor: string
  sunColor: string
  sunIntensity: number
  ambient: number
  hasDustStorms: boolean
  baseRad: number // mSv per game-hour outside
  facts: string[]
}

export const PLANETS: Record<Planet, PlanetConfig> = {
  moon: {
    name: 'Luna — Shackleton Rim',
    gravity: 1.62,
    solarPeak: 1.0,
    dayFrac: 0.68,
    skyTop: '#000004',
    skyHorizon: '#0a0a12',
    fogColor: '#060608',
    fogDensity: 0.0015,
    groundColor: '#8a8781',
    groundColor2: '#5d5a55',
    rockColor: '#75726c',
    sunColor: '#fff4e0',
    sunIntensity: 3.2,
    ambient: 0.28,
    hasDustStorms: false,
    baseRad: 0.42,
    facts: [
      "Lunar gravity is 1/6 of Earth's — you can jump higher but there is no air: abrasive electrostatic dust clings to everything.",
      'A lunar day lasts ~29.5 Earth days. Compressed here: solar power dies at night — batteries and rationing are life or death.',
      'Polar craters like Shackleton contain water ice — mining it gives drinking water, oxygen and fuel.',
      'With no atmosphere, galactic cosmic rays and solar particle events are a constant danger. Regolith shielding helps.',
      'The Moon has no global magnetic field, so solar storms hit the surface unfiltered.',
    ],
  },
  mars: {
    name: 'Mars — Jezero Flats',
    gravity: 3.71,
    solarPeak: 0.62,
    dayFrac: 0.7,
    skyTop: '#3f2c1e',
    skyHorizon: '#c58f5f',
    fogColor: '#b98a5e',
    fogDensity: 0.006,
    groundColor: '#a55c33',
    groundColor2: '#7c4224',
    rockColor: '#8d4f2c',
    sunColor: '#ffd9b0',
    sunIntensity: 2.4,
    ambient: 0.42,
    hasDustStorms: true,
    baseRad: 0.24,
    facts: [
      "Martian gravity is 38% of Earth's. The atmosphere is 95% CO₂ at under 1% of Earth's pressure — a suit is mandatory outside.",
      'Mars is 1.5 AU from the Sun: solar panels produce less than half of what they do in Earth orbit.',
      'Regional dust storms can block sunlight and coat panels in abrasive dust.',
      'MOXIE proved Mars air can be split into breathable oxygen — electrolysis and ISRU are the colony\'s lungs.',
      'Subsurface water ice can be extracted for life support and agriculture.',
    ],
  },
}

// Game time: 1 sol = 240 real seconds at 1x speed
export const SOL_SECONDS = 240
export const DAY_START = 0.02
export const DAY_END = 0.72

// ============================================================
// Central game state — single source of truth for game + UI
// ============================================================

export interface GameState {
  // ---- meta ----
  screen: Screen
  planet: Planet
  phase: number // 1..7 progression
  sol: number
  timeOfDay: number // 0..1
  timeScale: number // 1 | 4 | 12
  paused: boolean
  loadingText: string | null

  // ---- resources ----
  res: Record<ResourceKey, ResourceState>
  battery: { charge: number; cap: number; in: number; out: number }
  rates: Rates
  brownout: boolean // not enough power — non-critical systems offline
  blackout: boolean // total power loss — everything offline including O₂ production
  radiation: { dose: number; rate: number; storm: boolean }
  temperature: number // habitat interior °C
  outsideTemp: number
  population: number
  popCap: number
  crewHealth: number // 0..100 average colonist health
  playerVitals: number // 0..100 player health

  // ---- world ----
  buildings: BuildingInstance[]
  activeEvents: ActiveEvent[]
  log: LogEntry[]
  toasts: LogEntry[]
  radioLine: { text: string; id: string } | null
  objectives: Objective[]
  construction: ConstructionState | null
  placingType: BuildingType | null
  invalidPlacement: string | null

  // ---- player ----
  inside: string | null // building id ('ship' = spaceship habitat deck) player is inside (or null = EVA)
  suitO2: number
  suitO2Cap: number
  interaction: InteractionTarget | null
  interactionProgress: number
  driving: boolean

  // ---- meta/progress ----
  buildMenuOpen: boolean
  colonyPanelOpen: boolean
  upgrades: string[] // purchased upgrade ids
  researchTotal: number
  failureReason: string | null
  victoryStats: { sols: number; pop: number; eventsSurvived: number } | null
  eventsSurvived: number
  selfSufficientStreak: number

  // ---- actions ----
  startGame: (planet: Planet) => void
  setScreen: (s: Screen) => void
  tick: (dtReal: number) => void
  notify: (text: string, kind?: LogEntry['kind']) => void
  radio: (text: string) => void
  addLog: (text: string, kind?: LogEntry['kind']) => void
  setInteractionTarget: (t: InteractionTarget | null) => void
  setInteractionProgress: (p: number) => void
  completeInteraction: (id: string) => void
  beginPlacement: (type: BuildingType) => void
  cancelPlacement: () => void
  confirmPlacement: (pos: [number, number, number], rot: number) => boolean
  finishConstruction: () => void
  toggleDoor: (id: string) => void
  setInside: (id: string | null) => void
  enterRover: () => void
  exitRover: () => void
  setTimeScale: (n: number) => void
  setPaused: (p: boolean) => void
  toggleBuildMenu: (open?: boolean) => void
  toggleColonyPanel: (open?: boolean) => void
  buyUpgrade: (id: string) => void
  repairBuilding: (id: string) => boolean
  patchLeak: (eventId: string) => boolean
  triggerGameOver: (reason: string) => void
  triggerVictory: () => void
  restart: () => void
  skipConstruction: () => void
}
