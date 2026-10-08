// Building definitions — costs, effects, unlock phases.
import type { BuildingType, Rates } from './types'

export interface BuildingDef {
  type: BuildingType
  name: string
  short: string
  desc: string
  cost: number // materials
  unlockPhase: number
  powerUse: number // units per sol (when online)
  footprint: number // placement/collision radius (m)
  buildTime: number // real seconds for construction cinematic
  storage?: { oxygen?: number; water?: number; food?: number; materials?: number }
  popCap?: number
  interior?: boolean
  rate?: Partial<Omit<Rates, 'powerUse' | 'powerGen'>> // production/consumption per sol
  waterUse?: number // hidden water consumption per sol (electrolysis/greenhouse)
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Array',
    short: 'Solar',
    desc: 'Photovoltaic panels. Output depends on sun angle, dust and panel health. Dead at night — pair with batteries.',
    cost: 12,
    unlockPhase: 1,
    powerUse: 0,
    footprint: 4.4,
    buildTime: 7,
  },
  battery: {
    type: 'battery',
    name: 'Battery Bank',
    short: 'Battery',
    desc: '+100 units of energy storage. Keeps life support alive through the night.',
    cost: 10,
    unlockPhase: 1,
    powerUse: 0,
    footprint: 3.0,
    buildTime: 6,
    storage: { materials: 0 },
  },
  habitat: {
    type: 'habitat',
    name: 'Crew Habitat',
    short: 'Habitat',
    desc: 'Pressurized cylinder for 3 crew. Radiation shielding, life support hookups and an airlock.',
    cost: 30,
    unlockPhase: 2,
    powerUse: 4,
    footprint: 5.2,
    buildTime: 14,
    storage: { oxygen: 50 },
    popCap: 3,
    interior: true,
  },
  depot: {
    type: 'depot',
    name: 'Storage Depot',
    short: 'Depot',
    desc: 'Pressurized cargo containers. +150 materials, +60 water/O₂/food storage.',
    cost: 10,
    unlockPhase: 2,
    powerUse: 0.5,
    footprint: 3.4,
    buildTime: 6,
    storage: { materials: 150, water: 60, oxygen: 60, food: 60 },
  },
  extractor: {
    type: 'extractor',
    name: 'Ice Extractor',
    short: 'H₂O Rig',
    desc: 'Drills regolith and bakes out subsurface ice. Produces 18 water/sol. Wears down over time.',
    cost: 18,
    unlockPhase: 3,
    powerUse: 8,
    footprint: 3.6,
    buildTime: 10,
    rate: { waterGen: 18 },
  },
  oxygen: {
    type: 'oxygen',
    name: 'O₂ Generator',
    short: 'O₂ Gen',
    desc: 'Electrolyzes water into breathable oxygen. 14 O₂/sol, consumes 6 water/sol. Inspired by MOXIE.',
    cost: 16,
    unlockPhase: 3,
    powerUse: 4,
    footprint: 3.0,
    buildTime: 9,
    rate: { o2Gen: 14 },
    waterUse: 6,
  },
  comms: {
    type: 'comms',
    name: 'Comms Tower',
    short: 'Comms',
    desc: 'High-gain antenna to Earth. Enables resupply missions and early event warnings.',
    cost: 15,
    unlockPhase: 3,
    powerUse: 2,
    footprint: 2.8,
    buildTime: 8,
  },
  greenhouse: {
    type: 'greenhouse',
    name: 'Greenhouse',
    short: 'Greenhouse',
    desc: 'Hydroponic bay. Produces 12 food/sol, uses 9 water/sol and heat. Crops die if it freezes.',
    cost: 22,
    unlockPhase: 4,
    powerUse: 6,
    footprint: 5.4,
    buildTime: 12,
    rate: { foodGen: 12 },
    waterUse: 9,
  },
  lab: {
    type: 'lab',
    name: 'Research Lab',
    short: 'Lab',
    desc: 'Generates 1 research point/sol. Spend points on engineering upgrades.',
    cost: 25,
    unlockPhase: 5,
    powerUse: 6,
    footprint: 4.2,
    buildTime: 12,
    rate: {} as Partial<Rates>,
  },
  shelter: {
    type: 'shelter',
    name: 'Storm Shelter',
    short: 'Shelter',
    desc: 'Regolith-buried refuge. Near-total radiation protection during solar particle events.',
    cost: 14,
    unlockPhase: 5,
    powerUse: 1,
    footprint: 3.2,
    buildTime: 10,
    interior: true,
  },
  refinery: {
    type: 'refinery',
    name: 'ISRU Refinery',
    short: 'Refinery',
    desc: 'In-situ resource utilization: bakes regolith into construction sinter. +10 materials/sol.',
    cost: 28,
    unlockPhase: 5,
    powerUse: 12,
    footprint: 4.6,
    buildTime: 14,
    rate: { matGen: 10 },
  },
}

export const BUILD_ORDER: BuildingType[] = [
  'solar', 'battery', 'depot', 'habitat',
  'extractor', 'oxygen', 'comms', 'greenhouse',
  'lab', 'shelter', 'refinery',
]

export interface UpgradeDef {
  id: string
  name: string
  desc: string
  cost: number // research points
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'solar_eff',
    name: 'High-Efficiency Cells',
    desc: 'Perovskite-tandem solar cells: +30% panel output.',
    cost: 3,
  },
  {
    id: 'hydro_yield',
    name: 'Optimized Hydroponics',
    desc: 'LED spectra + CO₂ enrichment: +50% greenhouse food output.',
    cost: 4,
  },
  {
    id: 'water_reclaim',
    name: 'Water Reclamation',
    desc: 'Closed-loop urine/filtration recovery: -35% crew water use.',
    cost: 4,
  },
  {
    id: 'suit_o2',
    name: 'EVA Suit Upgrade',
    desc: 'High-pressure O₂ tanks: +60% suit oxygen capacity.',
    cost: 3,
  },
  {
    id: 'rad_shield',
    name: 'Hydrogenated Shielding',
    desc: 'Polyethylene-lined habitats: -40% habitat radiation dose.',
    cost: 5,
  },
]
