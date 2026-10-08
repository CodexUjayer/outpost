// Scene — assembles the 3D world: sky, terrain, buildings, rover, player,
// cinematics, particles + simulation driver, audio sync, placement ghost.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { PLANETS, type BuildingType } from '@/game/types'
import { BUILDINGS } from '@/game/buildings'
import { heightAt, slopeAt, COLONY_RADIUS } from '@/game/terrain'
import { LANDER_FOOTPRINT } from '@/game/lander'
import { input } from '@/game/input'
import { audio } from '@/game/audio'
import { emitBurst, emit } from './particles'
import SkyDome from './SkyDome'
import Terrain from './Terrain'
import Rocks from './Rocks'
import Particles from './Particles'
import { BuildingView } from './Buildings'
import Rover, { roverState } from './Rover'
import Player, { fpState } from './Player'
import Arms from './Arms'
import { Crew } from './Astronaut'
import LandingCinematic from './Landing'
import ConstructionCinematic from './Construction'
import ShipInterior from './ShipInterior'
import { getMats } from './materials'

// ================================================================
// Sim driver — advances the colony simulation + global shortcuts
// ================================================================
function SimDriver() {
  const fHold = useRef(0)
  useFrame((_, dt) => {
    const st = useGame.getState()
    if (st.screen === 'playing' || st.screen === 'landing') {
      st.tick(dt)
    }
    // hold-F skip for cinematics (landing, title sequence, mission film)
    if (input.down('KeyF') && (st.construction || st.screen === 'landing' || st.screen === 'trailer' || st.screen === 'cutscene')) {
      fHold.current += dt
      if (fHold.current > 0.7) {
        fHold.current = -1.5
        if (st.construction) st.skipConstruction()
        else st.setScreen('playing')
      }
    } else if (fHold.current > 0) {
      fHold.current = 0
    }
    input.endFrame()
  })
  return null
}

// ================================================================
// Audio sync — declaratively drives the procedural audio engine
// ================================================================
function AudioSync() {
  const envT = useRef(0)
  const leakHandles = useRef<Map<string, string>>(new Map())
  const radioId = useRef('')
  const bgmStarted = useRef(false)
  const machIn = useRef(14)

  useEffect(() => {
    return useGame.subscribe((s) => {
      if (s.radioLine && s.radioLine.id !== radioId.current) {
        radioId.current = s.radioLine.id
        if (s.screen === 'playing') {
          audio.radioBlip()
          audio.radioVoice(2.6)
        }
      }
      // background music: user-supplied ambient track, started once and
      // looped quietly for the rest of the mission
      if (s.screen === 'playing' && !bgmStarted.current) {
        bgmStarted.current = true
        audio.setBgm(true, 0.16)
      }
    })
  }, [])

  useFrame((state, dt) => {
    const st = useGame.getState()
    if (!audio.ready) return
    const fwd = new THREE.Vector3()
    state.camera.getWorldDirection(fwd)
    audio.setListener(state.camera.position, fwd)

    envT.current -= dt
    if (envT.current <= 0) {
      envT.current = 0.25
      const dustStorm = st.activeEvents.some((e) => e.type === 'dust_storm')
      const storm = st.radiation.storm || dustStorm
      // during the title sequence / mission film the game audio is ducked to room tone
      const cutscene = st.screen === 'cutscene' || st.screen === 'trailer'
      audio.setEnvironment({
        inside: st.inside !== null || cutscene,
        planet: st.planet,
        windIntensity: cutscene ? 0 : storm ? 1.2 : st.inside ? 0 : 0.22,
        storm: cutscene ? false : storm,
      })
      audio.setFan(st.inside !== null ? 0.7 : cutscene ? 0 : 0.04)
      const severe = st.activeEvents.some((e) => e.severity === 'severe') || st.blackout || st.brownout
      audio.setAlarm(severe && st.screen === 'playing' && !st.paused)
      const lowO2 = st.inside === null ? st.suitO2 < 30 : st.res.oxygen.amount < 15
      audio.setHeartbeat(cutscene ? 0 : lowO2 ? 0.9 : st.playerVitals < 45 ? 0.5 : 0)
      // NOTE: suit breathing ambience intentionally removed — it read as a
      // distracting "shush… shush…" behind everything.

      // ---- random machinery sounds working on the planet ----
      const playingNow = st.screen === 'playing' && !st.paused && !st.construction
      if (playingNow && st.inside === null) {
        machIn.current -= 0.25
        if (machIn.current <= 0) {
          machIn.current = 9 + Math.random() * 18
          audio.playMachinery(0.08 + Math.random() * 0.07)
        }
      }
    }

    // leak hiss loops
    const leaks = st.activeEvents.filter((e) => e.type === 'oxygen_leak')
    for (const [id, h] of leakHandles.current) {
      if (!leaks.some((e) => e.id === id)) {
        audio.stopLoop(h)
        leakHandles.current.delete(id)
      }
    }
    for (const ev of leaks) {
      if (!leakHandles.current.has(ev.id)) {
        const h = audio.leakHiss()
        if (h) leakHandles.current.set(ev.id, h)
      } else {
        const h = leakHandles.current.get(ev.id)
        if (h && ev.data.leakPos) {
          audio.setLoopPosition(h, { x: ev.data.leakPos[0], y: ev.data.leakPos[1], z: ev.data.leakPos[2] })
        }
      }
    }
    void input
  })
  return null
}

// ================================================================
// Placement ghost — ray-march terrain under crosshair, validate, place
// ================================================================
function PlacementGhost({ type }: { type: BuildingType }) {
  const { camera } = useThree()
  const ref = useRef<THREE.Group>(null)
  const ringMat = useRef<THREE.MeshStandardMaterial>(null)
  const poleMat = useRef<THREE.MeshStandardMaterial>(null)
  const valid = useRef(false)
  const lastInvalid = useRef<string | null>(null)
  const wasL = useRef(false)
  const wasR = useRef(false)
  const m = getMats()

  useFrame(() => {
    const st = useGame.getState()
    const g = ref.current
    if (!g) return
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const origin = camera.position
    let found: THREE.Vector3 | null = null
    let prevAbove = origin.y - heightAt(origin.x, origin.z)
    for (let t = 2; t < 90; t += 1.0) {
      const x = origin.x + dir.x * t
      const y = origin.y + dir.y * t
      const z = origin.z + dir.z * t
      const above = y - heightAt(x, z)
      if (above <= 0 && prevAbove > 0) {
        found = new THREE.Vector3(x, heightAt(x, z), z)
        break
      }
      prevAbove = above
    }
    if (!found) {
      g.visible = false
      return
    }
    g.visible = true
    g.position.copy(found)
    let reason: string | null = null
    if (slopeAt(found.x, found.z) > 0.42) reason = 'Terrain too steep'
    const dOrigin = Math.hypot(found.x, found.z)
    if (dOrigin > COLONY_RADIUS) reason = 'Too far from base camp'
    if (dOrigin < LANDER_FOOTPRINT + 2.6) reason = 'Too close to the lander'
    if (!reason) {
      for (const b of st.buildings) {
        const d = Math.hypot(found.x - b.pos[0], found.z - b.pos[2])
        const need =
          (b.id === 'lander' ? LANDER_FOOTPRINT : BUILDINGS[b.type]?.footprint ?? 3) +
          BUILDINGS[type].footprint + 0.8
        if (d < need) {
          reason = b.id === 'lander' ? 'Too close to lander' : `Too close to ${BUILDINGS[b.type].name}`
          break
        }
      }
    }
    if (st.res.materials.amount < BUILDINGS[type].cost) reason = 'Not enough materials'
    valid.current = !reason
    if (lastInvalid.current !== reason) {
      lastInvalid.current = reason
      useGame.setState({ invalidPlacement: reason })
    }
    const col = valid.current ? '#37d067' : '#e04830'
    if (ringMat.current) {
      ringMat.current.color.set(col)
      ringMat.current.emissive.set(col)
    }
    if (poleMat.current) poleMat.current.emissive.set(col)

    // edge-detect mouse buttons (robust to useFrame ordering)
    const isL = input.mouseLeft
    const isR = input.mouseRight
    const clickL = isL && !wasL.current
    const clickR = isR && !wasR.current
    wasL.current = isL
    wasR.current = isR
    if (valid.current && clickL) {
      const rot = Math.atan2(0 - found.x, 0 - found.z)
      st.confirmPlacement([found.x, found.y, found.z], rot)
    } else if (clickR || input.pressed('Escape')) {
      st.cancelPlacement()
    }
  })

  const fp = BUILDINGS[type].footprint
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[fp * 0.82, fp * 0.95, 36]} />
        <meshStandardMaterial ref={ringMat} color="#37d067" emissive="#37d067" emissiveIntensity={0.9} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh position={[0, fp * 0.45, 0]}>
        <boxGeometry args={[fp * 1.1, fp * 0.9, fp * 1.1]} />
        <meshStandardMaterial ref={poleMat} color="#20301f" emissive="#37d067" emissiveIntensity={0.25} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[fp * 0.8, 24]} />
        <meshStandardMaterial color="#9aa89a" transparent opacity={0.15} depthWrite={false} />
      </mesh>
      <primitive object={m.darkMetal} attach="material-unused" />
    </group>
  )
}

// ================================================================
// Meteor / event FX
// ================================================================
function EventFX() {
  const seen = useRef<Set<string>>(new Set())
  useFrame(() => {
    const st = useGame.getState()
    if (st.screen !== 'playing') return
    for (const ev of st.activeEvents) {
      if (seen.current.has(ev.id)) continue
      seen.current.add(ev.id)
      if (ev.type === 'meteor') {
        const target = st.buildings.find((b) => b.id === ev.data.targetId)
        if (target) {
          fpState.shake = 1.2
          audio.meteorBoom()
          audio.thud(0.9)
          emitBurst([target.pos[0], target.pos[1] + 1.3, target.pos[2]], 26, { speed: 7, life: 1.8, size: 0.55, color: '#8f887c' })
          emitBurst([target.pos[0], target.pos[1] + 1.0, target.pos[2]], 8, { speed: 5, life: 0.5, size: 0.12, color: '#ffcf80', gravity: -3 })
        }
      } else if (ev.type === 'solar_storm') {
        audio.alarmPing()
      }
    }
    if (seen.current.size > 40) seen.current = new Set(Array.from(seen.current).slice(-20))
  })
  return null
}

// ================================================================
// Procedural environment map — subtle starlight/surface bounce so PBR
// metals (visor, hulls, foil) have something to reflect. No network assets.
// ================================================================
function ProceduralEnv() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 32
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 32)
    grad.addColorStop(0, '#020204')
    grad.addColorStop(0.48, '#0a0a0e')
    grad.addColorStop(0.56, '#39352e')
    grad.addColorStop(1, '#191713')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 32)
    const tex = new THREE.CanvasTexture(c)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromEquirectangular(tex).texture
    scene.environment = env
    scene.environmentIntensity = 0.22
    pmrem.dispose()
    tex.dispose()
    return () => {
      scene.environment = null
      env.dispose()
    }
  }, [gl, scene])
  return null
}

// ================================================================
// Planet haze — thin exponential fog tinted per planet (mars gets a
// warm butterscotch haze; moon stays near-vacuum crisp). Softens the
// horizon and grounds distant terrain visually.
// ================================================================
function PlanetHaze({ planet }: { planet: 'moon' | 'mars' }) {
  const { scene } = useThree()
  useEffect(() => {
    const mars = planet === 'mars'
    const fog = new THREE.FogExp2(mars ? '#4a311f' : '#0b0b0d', mars ? 0.011 : 0.0048)
    scene.fog = fog
    return () => {
      scene.fog = null
    }
  }, [scene, planet])
  return null
}

// ================================================================
// Dust devil — a small wandering vortex of regolith far off, adds
// life to the landscape. Pure particle emissions, no extra geometry.
// ================================================================
function DustDevil({ planet }: { planet: 'moon' | 'mars' }) {
  const pos = useRef(new THREE.Vector2(60, -40))
  const dir = useRef(Math.random() * Math.PI * 2)
  const acc = useRef(0)
  useFrame((_, dtRaw) => {
    const st = useGame.getState()
    if (st.screen !== 'playing' || st.paused || st.construction) return
    const dt = Math.min(dtRaw, 0.05)
    const p = pos.current
    const px = fpState.pos
    // keep wandering; re-seed when it drifts too far from (or lands on) the player
    const d = Math.hypot(p.x - px.x, p.y - px.z)
    if (d > 150 || d < 25) {
      const a = Math.random() * Math.PI * 2
      const r = 45 + Math.random() * 40
      p.set(px.x + Math.cos(a) * r, px.z + Math.sin(a) * r)
      dir.current = Math.random() * Math.PI * 2
    }
    dir.current += (Math.random() - 0.5) * dt * 0.6
    p.x += Math.sin(dir.current) * dt * 1.4
    p.y += Math.cos(dir.current) * dt * 1.4
    // swirl of dust particles rising through the vortex
    acc.current += dt * 26
    const col = planet === 'mars' ? '#8a5a38' : '#7d766c'
    while (acc.current >= 1) {
      acc.current -= 1
      const a = Math.random() * Math.PI * 2
      const r = 0.4 + Math.random() * 2.2
      const h = Math.random() * 5.5
      emit({
        pos: [p.x + Math.cos(a) * r, heightAt(p.x, p.y) + h, p.y + Math.sin(a) * r],
        vel: [-Math.sin(a) * (1.2 + h * 0.35), 1.5 + Math.random(), -Math.cos(a) * (1.2 + h * 0.35)],
        life: 2.2 + Math.random(),
        size: 0.9 + Math.random() * 1.4,
        color: col,
        gravity: -0.12,
      })
    }
  })
  return null
}

// ================================================================
export default function Scene() {
  const planet = useGame((s) => s.planet)
  const screen = useGame((s) => s.screen)
  const inside = useGame((s) => s.inside)
  const buildings = useGame((s) => s.buildings)
  const construction = useGame((s) => s.construction)
  const placingType = useGame((s) => s.placingType)
  const cfg = PLANETS[planet]

  return (
    <>
      <ProceduralEnv />
      <PlanetHaze planet={planet} />
      <SkyDome planet={planet} />
      <Terrain planet={planet} />
      <Rocks planet={planet} />
      <Particles groundColor={cfg.groundColor} />
      {screen !== 'landing' && screen !== 'cutscene' && buildings.map((b) => <BuildingView key={b.id} b={b} />)}
      {screen !== 'landing' && screen !== 'cutscene' && <Rover />}
      {screen !== 'landing' && screen !== 'cutscene' && <Crew />}
      <ShipInterior visible={screen === 'playing' && inside === 'ship'} />
      <Player />
      <Arms />
      {screen === 'landing' && <LandingCinematic />}
      {construction && <ConstructionCinematic />}
      {placingType && screen === 'playing' && <PlacementGhost type={placingType} />}
      <EventFX />
      <AudioSync />
      <SimDriver />
      <DustDevil planet={planet} />
    </>
  )
}

export { roverState }
