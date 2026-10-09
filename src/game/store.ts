// ============================================================
// Central game state (zustand). All gameplay state lives here.
// The 3D scene and HUD both read from this store.
// ============================================================
import { create } from 'zustand'
import type {
  GameState, Planet, BuildingType, BuildingInstance,
  ResourceKey, ResourceState, LogEntry, InteractionTarget,
} from './types'
import { PLANETS } from './types'
import { BUILDINGS } from './buildings'
import { runSimulation, resetTimers } from './simulation'
import { heightAt } from './terrain'

let idCounter = 1
export const nextId = () => `${Date.now().toString(36)}-${idCounter++}`

const RES_KEYS: ResourceKey[] = ['oxygen', 'water', 'food', 'materials', 'research']

function mkRes(oxygen: number, water: number, food: number, materials: number): Record<ResourceKey, ResourceState> {
  return {
    oxygen: { amount: oxygen, cap: oxygen },
    water: { amount: water, cap: water },
    food: { amount: food, cap: food },
    materials: { amount: materials, cap: materials },
    research: { amount: 0, cap: 99 },
  }
}


export const useGame = create<GameState>((set, get) => ({
  screen: 'menu',
  planet: 'moon',
  phase: 1,
  sol: 1,
  timeOfDay: 0.1,
  timeScale: 1,
  paused: false,
  loadingText: null,

  res: mkRes(100, 100, 80, 60),
  battery: { charge: 40, cap: 40, in: 0, out: 0 },
  rates: { powerGen: 0, powerUse: 0, o2Gen: 0, o2Use: 0, waterGen: 0, waterUse: 0, foodGen: 0, foodUse: 0, matGen: 0 },
  brownout: false,
  blackout: false,
  radiation: { dose: 0, rate: 0, storm: false },
  temperature: 21,
  outsideTemp: 20,
  population: 1,
  popCap: 2,
  crewHealth: 100,
  playerVitals: 100,

  buildings: [],
  activeEvents: [],
  log: [],
  toasts: [],
  radioLine: null,
  objectives: [],
  construction: null,
  placingType: null,
  invalidPlacement: null,

  inside: null,
  suitO2: 100,
  suitO2Cap: 100,
  interaction: null,
  interactionProgress: 0,
  driving: false,

  buildMenuOpen: false,
  colonyPanelOpen: false,
  upgrades: [],
  researchTotal: 0,
  failureReason: null,
  victoryStats: null,
  eventsSurvived: 0,
  selfSufficientStreak: 0,

  // =============== actions ===============
  startGame: (planet) => {
    const base = planet === 'moon' ? 46 : 50
    set({
      screen: 'landing',
      planet,
      phase: 1,
      sol: 1,
      timeOfDay: 0.08,
      timeScale: 1,
      paused: false,
      res: mkRes(100, 100, 80, 60),
      battery: { charge: 40, cap: 40, in: 0, out: 0 },
      rates: { powerGen: 0, powerUse: 0, o2Gen: 0, o2Use: 0, waterGen: 0, waterUse: 0, foodGen: 0, foodUse: 0, matGen: 0 },
      brownout: false,
      blackout: false,
      radiation: { dose: 0, rate: 0, storm: false },
      temperature: 21,
      outsideTemp: planet === 'moon' ? 40 : -8,
      population: 1,
      popCap: 2,
      crewHealth: 100,
      playerVitals: 100,
      buildings: [
        {
          id: 'lander',
          type: 'depot', // lander is rendered specially; treat as depot for storage logic
          pos: [0, heightAt(0, 0), 0],
          rot: 0,
          health: 100,
          online: true,
          doorOpen: false,
          built: true,
        },
      ],
      activeEvents: [],
      log: [],
      toasts: [],
      radioLine: null,
      objectives: [
        { text: 'Deploy the spare solar array from the lander cargo', done: false },
        { text: 'Survive until Sol 2', done: false },
      ],
      construction: null,
      placingType: null,
      inside: null,
      suitO2: 100,
      suitO2Cap: planet === 'moon' ? 100 : 100,
      interaction: null,
      interactionProgress: 0,
      driving: false,
      buildMenuOpen: false,
      colonyPanelOpen: false,
      upgrades: [],
      researchTotal: 0,
      failureReason: null,
      victoryStats: null,
      eventsSurvived: 0,
      selfSufficientStreak: 0,
      loadingText: null,
    })
    // lander storage
    const s = get()
    s.res.materials.cap = base
    resetTimers()
    get().addLog(`Touchdown confirmed at ${PLANETS[planet].name}. All systems nominal.`, 'good')
  },

  setScreen: (s) => set({ screen: s }),

  tick: (dtReal) => {
    const st = get()
    if (st.screen !== 'playing' || st.paused || st.construction) {
      // construction pauses sim (cinematic handles its own timing)
      return
    }
    const dt = Math.min(dtReal, 0.12) * st.timeScale
    const result = runSimulation(st, dt)
    set(result.state as Partial<GameState>)
    for (const n of result.notify) get().notify(n.text, n.kind)
    for (const r of result.radio) {
      if (get().screen === 'playing') get().radio(r)
    }
  },

  notify: (text, kind = 'info') => {
    const t: LogEntry = { id: nextId(), sol: get().sol, text, kind }
    set((s) => ({ toasts: [...s.toasts.slice(-4), t] }))
    get().addLog(text, kind)
    // auto dismiss
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))
    }, 6000)
  },

  radio: (text) => {
    set({ radioLine: { text, id: nextId() } })
  },

  addLog: (text, kind = 'info') => {
    set((s) => ({ log: [...s.log.slice(-120), { id: nextId(), sol: get().sol, text, kind }] }))
  },

  setInteractionTarget: (t) => {
    const cur = get().interaction
    if (cur?.id === t?.id && cur?.kind === t?.kind && cur?.label === t?.label) return
    set({ interaction: t, interactionProgress: t ? get().interactionProgress : 0 })
  },

  setInteractionProgress: (p) => set({ interactionProgress: p }),

  completeInteraction: (id) => {
    const st = get()
    const it = st.interaction
    if (!it || it.id !== id) return
    switch (it.kind) {
      case 'door': {
        const b = st.buildings.find((x) => x.id === it.buildingId)
        if (b) {
          set({
            buildings: st.buildings.map((x) =>
              x.id === b.id ? { ...x, doorOpen: !x.doorOpen } : x,
            ),
          })
          st.notify(b.doorOpen ? 'Airlock closed — repressurizing' : 'Airlock cycling…', 'info')
        }
        break
      }
      case 'repair': {
        if (st.repairBuilding(it.buildingId)) {
          st.notify('Repair complete — systems restored', 'good')
        }
        break
      }
      case 'leak': {
        if (st.patchLeak(it.id)) {
          st.notify('Leak sealed with patch compound', 'good')
        }
        break
      }
      case 'console': {
        st.toggleColonyPanel(true)
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock()
        }
        break
      }
      case 'cargo_solar': {
        // deploy free solar array next to lander
        const lander = st.buildings.find((b) => b.id === 'lander')
        if (lander) {
          const pos: [number, number, number] = [lander.pos[0] + 9, 0, lander.pos[2] - 4]
          pos[1] = heightAt(pos[0], pos[2])
          const nb: BuildingInstance = {
            id: nextId(), type: 'solar', pos, rot: Math.PI * 0.25,
            health: 100, online: true, doorOpen: false, built: true,
          }
          set({ buildings: [...st.buildings, nb] })
          st.notify('Spare solar array deployed and cabled', 'good')
          st.radio('Houston, solar array is up. We have power for the night.')
          // mark objective done via simulation milestone check
        }
        break
      }
      case 'rover': {
        st.enterRover()
        break
      }
      case 'shelter': {
        if (it.buildingId === 'lander' && st.inside === null) {
          // board the real spaceship interior (Spaceship.blend habitat deck)
          st.setInside('ship')
          st.radio('Intrepid, you have the ship. Depot systems are on the console bank up front.')
        } else if (st.inside === it.buildingId) {
          st.setInside(null)
        } else {
          st.setInside(it.buildingId)
        }
        break
      }
      case 'ship_exit': {
        st.setInside(null)
        break
      }
      case 'ship_info': {
        if (it.id === 'ship-cryo') {
          st.notify('Cryo bay: 3 hibernation pods idle — biosleep systems nominal', 'info')
        } else if (it.id === 'ship-emergency') {
          st.notify('Emergency computer: storm protocol armed — shelter stations ready', 'info')
        } else if (it.id === 'ship-commons') {
          st.notify(`Galley stores: food ${Math.floor(st.res.food.amount)}/${st.res.food.cap} · water ${Math.floor(st.res.water.amount)}/${st.res.water.cap}`, 'info')
        }
        break
      }
    }
  },

  beginPlacement: (type) => {
    const st = get()
    const def = BUILDINGS[type]
    if (st.construction) {
      st.notify('Construction in progress — wait for the crew to finish', 'warn')
      return
    }
    if (def.unlockPhase > st.phase) {
      st.notify(`${def.name} unlocks in Phase ${def.unlockPhase}`, 'warn')
      return
    }
    if (st.res.materials.amount < def.cost) {
      st.notify(`Not enough materials — need ${def.cost}, have ${Math.floor(st.res.materials.amount)}`, 'warn')
      return
    }
    set({ placingType: type, buildMenuOpen: false, invalidPlacement: null })
  },

  cancelPlacement: () => set({ placingType: null, invalidPlacement: null }),

  confirmPlacement: (pos, rot) => {
    const st = get()
    const type = st.placingType
    if (!type) return false
    if (st.construction) return false
    const def = BUILDINGS[type]
    if (st.res.materials.amount < def.cost) return false
    // ghost validation already done by scene; deduct materials & start construction
    set({
      res: { ...st.res, materials: { ...st.res.materials, amount: st.res.materials.amount - def.cost } },
      placingType: null,
      construction: { type, pos, rot, t: 0, dur: def.buildTime },
      invalidPlacement: null,
    })
    get().notify(`${def.name} — construction started`, 'info')
    return true
  },

  finishConstruction: () => {
    const st = get()
    const c = st.construction
    if (!c) return
    const nb: BuildingInstance = {
      id: nextId(), type: c.type, pos: c.pos, rot: c.rot,
      health: 100, online: true, doorOpen: false, built: true,
    }
    set({ buildings: [...st.buildings, nb], construction: null })
    get().notify(`${BUILDINGS[c.type].name} online`, 'good')
  },

  toggleDoor: (id) => {
    set((s) => ({
      buildings: s.buildings.map((b) => (b.id === id ? { ...b, doorOpen: !b.doorOpen } : b)),
    }))
  },

  setInside: (id) => {
    const st = get()
    const wasInside = st.inside !== null
    set({ inside: id })
    if (!wasInside && id) {
      st.notify('Suit depressurized — helmet off. Ah, breathable air.', 'info')
    }
  },

  enterRover: () => set({ driving: true }),
  exitRover: () => set({ driving: false }),

  setTimeScale: (n) => set({ timeScale: n }),
  setPaused: (p) => set({ paused: p }),
  toggleBuildMenu: (open) => set((s) => ({ buildMenuOpen: open ?? !s.buildMenuOpen, placingType: null })),
  toggleColonyPanel: (open) => set((s) => ({ colonyPanelOpen: open ?? !s.colonyPanelOpen })),

  buyUpgrade: (id) => {
    const st = get()
    const cost = id === 'solar_eff' ? 3 : id === 'hydro_yield' ? 4 : id === 'water_reclaim' ? 4 : id === 'suit_o2' ? 3 : 5
    const name = id
    if (st.upgrades.includes(id)) return
    if (st.res.research.amount < cost) {
      st.notify(`Need ${cost} research points`, 'warn')
      return
    }
    set({
      res: { ...st.res, research: { ...st.res.research, amount: st.res.research.amount - cost } },
      upgrades: [...st.upgrades, id],
    })
    if (id === 'suit_o2') {
      set((s) => ({ suitO2Cap: Math.round(s.suitO2Cap * 1.6), suitO2: s.suitO2Cap * 1.6 }))
    }
    get().notify(`Upgrade installed: ${name.replace('_', ' ')}`, 'good')
  },

  repairBuilding: (id) => {
    const st = get()
    if (st.res.materials.amount < 4) {
      st.notify('Need 4 materials to repair', 'warn')
      return false
    }
    set({
      res: { ...st.res, materials: { ...st.res.materials, amount: st.res.materials.amount - 4 } },
      buildings: st.buildings.map((b) =>
        b.id === id ? { ...b, health: Math.min(100, b.health + 45), online: b.health + 45 > 40 } : b,
      ),
    })
    return true
  },

  patchLeak: (eventId) => {
    const st = get()
    const ev = st.activeEvents.find((e) => e.id === eventId)
    if (!ev) return false
    set({ activeEvents: st.activeEvents.filter((e) => e.id !== eventId) })
    get().eventsSurvived = get().eventsSurvived + 1
    return true
  },

  triggerGameOver: (reason) => {
    if (get().screen === 'gameover') return
    set({ screen: 'gameover', failureReason: reason, driving: false })
  },

  triggerVictory: () => {
    if (get().screen === 'victory') return
    const st = get()
    set({
      screen: 'victory',
      victoryStats: { sols: st.sol, pop: st.population, eventsSurvived: st.eventsSurvived },
      driving: false,
    })
  },

  restart: () => set({ screen: 'menu' }),

  skipConstruction: () => {
    const st = get()
    if (!st.construction) return
    // Jump the cinematic to the end
    const c = st.construction
    set({ construction: { ...c, t: c.dur } })
  },
}))

// Convenience selectors
export const selectRes = (s: GameState) => s.res
export const selectPhase = (s: GameState) => s.phase

// debug handle for browser-console testing
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game?: unknown }).__game = useGame
}

export function canAfford(res: Record<ResourceKey, ResourceState>, type: BuildingType): boolean {
  return res.materials.amount >= BUILDINGS[type].cost
}

export { RES_KEYS }
