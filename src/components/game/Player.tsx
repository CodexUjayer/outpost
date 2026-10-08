// First-person astronaut controller: movement, collisions, EVA, interactions.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { heightAt } from '@/game/terrain'
import { BUILDINGS } from '@/game/buildings'
import { PLANETS, type InteractionTarget } from '@/game/types'
import { input } from '@/game/input'
import { audio } from '@/game/audio'
import { roverState } from './Rover'
import { interactionAnchors } from './Buildings'
import { emit, emitBurst } from './particles'
import { nextId } from '@/game/store'
import {
  LANDER_CABIN_R,
  LANDER_EXIT_DIST,
  LANDER_FLOOR,
  LANDER_FOOTPRINT,
} from '@/game/lander'
import {
  SHIP_ZONE,
  SHIP_ANCHORS,
  shipFloorAt,
  shipCollide,
  shipInsideBounds,
  resetShipFloor,
  shipWorldAnchor,
} from '@/game/shipInterior'

// shared first-person state (read by Arms + camera FX)
export const fpState = {
  pos: new THREE.Vector3(4, 0, 13),
  yaw: Math.PI * 0.95,
  pitch: -0.05,
  vel: new THREE.Vector3(),
  speed: 0,
  walkPhase: 0,
  reach: 0,
  lookVel: { x: 0, y: 0 },
  grounded: true,
  shake: 0,
}

const EYE = 1.62
const ANGLE_DIFF = (a: number, b: number) => {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export function floorHeight(type: string): number {
  if (type === 'habitat') return 0.36
  if (type === 'greenhouse') return 0.2
  if (type === 'shelter') return 0.62
  return 0
}

function floorOf(b: { id: string; type: string; pos: [number, number, number] }): number {
  return b.id === 'lander' ? LANDER_FLOOR : floorHeight(b.type)
}

function groundAt(x: number, z: number, insideId: string | null, buildings: ReturnType<typeof useGame.getState>['buildings']): number {
  if (insideId) {
    const b = buildings.find((x2) => x2.id === insideId)
    if (b) {
      const fp = BUILDINGS[b.type]?.footprint ?? 3
      // lander cabin floor extends a bit past the walkable radius so the
      // player never falls through while approaching the hatch to exit
      const reach = b.id === 'lander' ? LANDER_CABIN_R + 1.0 : fp * 0.95
      const d = Math.hypot(x - b.pos[0], z - b.pos[2])
      if (d < reach) return b.pos[1] + floorOf(b)
    }
  }
  return heightAt(x, z)
}

export default function Player() {
  const { camera, gl } = useThree()
  const scanTimer = useRef(0)
  const stepDist = useRef(0)
  const prevInside = useRef<string | null>(null)
  const prevDoors = useRef<Record<string, boolean>>({})
  const holdSound = useRef(0)
  const camFov = useRef(75)
  const initialized = useRef(false)
  const wasDriving = useRef(false)

  // mouse look
  useEffect(() => {
    ;(window as unknown as { __fp?: unknown }).__fp = fpState
    ;(window as unknown as { __input?: unknown }).__input = input
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return
      const st = useGame.getState()
      if (st.screen !== 'playing' || st.paused || st.construction || st.driving) return
      fpState.yaw -= e.movementX * 0.0021
      fpState.pitch -= e.movementY * 0.0021
      fpState.pitch = THREE.MathUtils.clamp(fpState.pitch, -1.45, 1.45)
      fpState.lookVel.x = e.movementX * 0.06
      fpState.lookVel.y = e.movementY * 0.06
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  // reset spawn on first activation per game — the player wakes up INSIDE the
  // Intrepid's habitat deck (airlock), not out on the regolith
  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      if (
        s.screen === 'playing' &&
        (prev.screen === 'landing' || prev.screen === 'trailer' || prev.screen === 'cutscene')
      ) {
        // requesting inside='ship' makes the boarding teleport below
        // materialize us at the airlock anchor with the airlock sound
        if (!s.inside) useGame.setState({ inside: 'ship' })
        prevInside.current = null
        fpState.vel.set(0, 0, 0)
      }
    })
    return unsub
  }, [])

  useFrame((state, dtRaw) => {
    // debug: expose the live render scene (used by probes / browser tooling)
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __scene?: unknown }).__scene = state.scene
      ;(window as unknown as { __r3fCamera?: unknown }).__r3fCamera = state.camera
    }
    const st = useGame.getState()
    const dt = Math.min(dtRaw, 0.05)
    const cfg = PLANETS[st.planet]

    // ---------- spawn init ----------
    if (!initialized.current && st.screen === 'playing') {
      initialized.current = true
      // wake up INSIDE the ship — the boarding teleport (prevInside watcher)
      // materializes us at the airlock anchor, facing into the habitat deck
      if (!st.inside) useGame.setState({ inside: 'ship' })
      prevInside.current = null
    }
    if (st.screen !== 'playing') {
      if (st.screen === 'landing' || st.construction) {
        // cinematic controls camera — do nothing
      }
      return
    }

    // ---------- driving: third-person chase camera ----------
    if (st.driving) {
      wasDriving.current = true
      const fwd = new THREE.Vector3(Math.sin(roverState.heading), 0, Math.cos(roverState.heading))
      const camTarget = roverState.pos.clone()
        .addScaledVector(fwd, -7.2)
        .add(new THREE.Vector3(0, 3.2, 0))
      const groundMin = heightAt(camTarget.x, camTarget.z) + 1.1
      if (camTarget.y < groundMin) camTarget.y = groundMin
      camera.position.lerp(camTarget, Math.min(1, dt * 3.5))
      const look = roverState.pos.clone().addScaledVector(fwd, 3).add(new THREE.Vector3(0, 1.4, 0))
      const m4 = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0))
      const q = new THREE.Quaternion().setFromRotationMatrix(m4)
      camera.quaternion.slerp(q, Math.min(1, dt * 4))
      // exit rover with E (guarded against same-frame re-board by Rover/exitGuardUntil)
      if (input.pressed('KeyE')) {
        const s = useGame.getState()
        if (s.driving) {
          s.exitRover()
          roverState.exitGuardUntil = performance.now() + 900
          audio.setRoverEngine(false, 0)
          audio.doorServo()
        }
      }
      fpState.pos.copy(roverState.pos)
      return
    }

    // just stepped out of the rover: stand beside it (not inside the mesh)
    if (wasDriving.current) {
      wasDriving.current = false
      const h = roverState.heading
      // player-right when facing the rover's forward direction
      const rx = -Math.cos(h)
      const rz = Math.sin(h)
      const ex = roverState.pos.x + rx * 2.3
      const ez = roverState.pos.z + rz * 2.3
      fpState.pos.set(ex, heightAt(ex, ez) + EYE, ez)
    }

    // ---------- paused / construction: freeze ----------
    if (st.paused || st.construction) {
      fpState.lookVel.x *= 0.8
      fpState.lookVel.y *= 0.8
      return
    }

    // ---------- movement ----------
    const locked = !!document.pointerLockElement
    const fwdInput = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0)
    const sideInput = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0)
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight')
    const maxSpeed = sprint ? 5.9 : 3.4
    const insideBuilding = st.inside ? st.buildings.find((b) => b.id === st.inside) : null
    const speedMul = insideBuilding ? 0.75 : 1

    const sin = Math.sin(fpState.yaw)
    const cos = Math.cos(fpState.yaw)
    // forward is -Z in camera space rotated by yaw
    const wishX = (-sin * fwdInput + cos * sideInput)
    const wishZ = (-cos * fwdInput - sin * sideInput)
    const wishLen = Math.hypot(wishX, wishZ)
    if (wishLen > 0.01 && locked) {
      fpState.vel.x += (wishX / wishLen) * 26 * dt
      fpState.vel.z += (wishZ / wishLen) * 26 * dt
    }
    // friction
    const fr = Math.min(1, dt * (fpState.grounded ? 9 : 1.2))
    fpState.vel.x -= fpState.vel.x * fr
    fpState.vel.z -= fpState.vel.z * fr
    // clamp horizontal speed
    const hSpeed = Math.hypot(fpState.vel.x, fpState.vel.z)
    const effMax = maxSpeed * speedMul
    if (hSpeed > effMax) {
      fpState.vel.x *= effMax / hSpeed
      fpState.vel.z *= effMax / hSpeed
    }
    // gravity & jump (planet gravity)
    fpState.vel.y -= cfg.gravity * dt
    const gy = st.inside === 'ship'
      ? shipFloorAt(fpState.pos.x, fpState.pos.y, fpState.pos.z)
      : groundAt(fpState.pos.x, fpState.pos.z, st.inside, st.buildings)
    if (fpState.pos.y <= gy + EYE + 0.02) {
      fpState.pos.y = gy + EYE
      if (fpState.vel.y < 0) fpState.vel.y = 0
      fpState.grounded = true
      if (input.down('Space') && locked) {
        const jumpH = st.planet === 'moon' ? 1.15 : 0.62
        fpState.vel.y = Math.sqrt(2 * cfg.gravity * jumpH)
        fpState.grounded = false
        if (st.inside === null) audio.footstep('regolith', 0.7)
      }
    } else {
      fpState.grounded = false
    }

    // integrate
    const nx = fpState.pos.x + fpState.vel.x * dt
    const nz = fpState.pos.z + fpState.vel.z * dt
    fpState.pos.x = THREE.MathUtils.clamp(nx, -160, 160)
    fpState.pos.z = THREE.MathUtils.clamp(nz, -160, 160)
    fpState.pos.y += fpState.vel.y * dt

    // ---------- collisions & inside detection ----------
    if (st.inside === 'ship') {
      // real-geometry collision on the habitat deck (BVH push-out + hard clamp)
      shipCollide(fpState.pos)
      if (!shipInsideBounds(fpState.pos.x, fpState.pos.y, fpState.pos.z)) {
        // safety net: never let the player leave the deck volume
        const s = SHIP_ANCHORS.spawn
        fpState.pos.set(SHIP_ZONE.x + s.x, SHIP_ZONE.y + s.y + EYE, SHIP_ZONE.z + s.z)
        fpState.vel.set(0, 0, 0)
      }
    } else {
    for (const b of st.buildings) {
      if (!b.built) continue
      const def = BUILDINGS[b.type]
      if (!def) continue
      const fp = b.id === 'lander' ? LANDER_FOOTPRINT : def.footprint
      const dx = fpState.pos.x - b.pos[0]
      const dz = fpState.pos.z - b.pos[2]
      const d0 = Math.hypot(dx, dz)
      const d = d0 < 0.001 ? 0.001 : d0
      const ndx = d0 < 0.001 ? 0 : dx / d0
      const ndz = d0 < 0.001 ? 1 : dz / d0
      const ang = Math.atan2(dx, dz)
      const doorAng = b.rot
      const inDoorSector = Math.abs(ANGLE_DIFF(ang, doorAng)) < 0.62
      if (st.inside === b.id) continue // handled below
      if (b.type === 'shelter') {
        if (d < fp + 0.4) {
          const push = fp + 0.4 - d
          fpState.pos.x += ndx * push
          fpState.pos.z += ndz * push
        }
        continue
      }
      if (def.interior && b.doorOpen && inDoorSector) {
        // walk through the airlock
        if (d < fp * 0.8 && st.inside === null && b.health > 40) {
          st.setInside(b.id)
          audio.airlock()
        }
        continue
      }
      if (d < fp + 0.35) {
        const push = fp + 0.35 - d
        fpState.pos.x += ndx * push
        fpState.pos.z += ndz * push
      }
    }
    } // end non-ship collision
    // exit detection
    if (st.inside) {
      const b = st.buildings.find((x) => x.id === st.inside)
      if (b) {
        const dx = fpState.pos.x - b.pos[0]
        const dz = fpState.pos.z - b.pos[2]
        const d = Math.hypot(dx, dz)
        const ang = Math.atan2(dx, dz)
        const inDoorSector = Math.abs(ANGLE_DIFF(ang, b.rot)) < 0.62
        if (b.id === 'lander') {
          // teleport cabin: leave through the hatch sector, clamp at the wall otherwise
          if (d > LANDER_CABIN_R + 0.8 && inDoorSector) {
            st.setInside(null)
            audio.airlock()
          } else if (d > LANDER_CABIN_R && !inDoorSector) {
            fpState.pos.x = b.pos[0] + (dx / d) * LANDER_CABIN_R
            fpState.pos.z = b.pos[2] + (dz / d) * LANDER_CABIN_R
          }
        } else if (b.type !== 'shelter') {
          const fp = BUILDINGS[b.type].footprint
          if (d > fp + 0.8 && inDoorSector) {
            st.setInside(null)
            audio.airlock()
          } else if (d > fp * 0.92 && !inDoorSector) {
            // push back inside (wall)
            const target = fp * 0.92
            fpState.pos.x = b.pos[0] + (dx / d) * target
            fpState.pos.z = b.pos[2] + (dz / d) * target
          }
        }
      }
    }
    // shelter/lander/ship enter/exit teleport
    if (prevInside.current !== st.inside) {
      if (st.inside === 'ship') {
        // board the habitat deck — materialize in the south airlock module,
        // facing forward into the ship (real Spaceship.blend interior)
        const s = SHIP_ANCHORS.spawn
        fpState.pos.set(SHIP_ZONE.x + s.x, SHIP_ZONE.y + s.y + EYE, SHIP_ZONE.z + s.z)
        fpState.yaw = 0
        fpState.pitch = -0.02
        fpState.vel.set(0, 0, 0)
        resetShipFloor()
        audio.airlock()
      } else if (st.inside) {
        const b = st.buildings.find((x) => x.id === st.inside)
        if (b && (b.type === 'shelter' || b.id === 'lander')) {
          if (b.id === 'lander') {
            // materialize mid-cabin, facing the flight console (+Z side)
            fpState.pos.set(b.pos[0] + 0.3, b.pos[1] + LANDER_FLOOR + EYE, b.pos[2] + 0.35)
            fpState.yaw = b.rot + Math.PI
          } else {
            fpState.pos.set(b.pos[0] + 0.3, b.pos[1] + floorOf(b) + EYE, b.pos[2] + 0.3)
          }
        }
      } else if (prevInside.current) {
        if (prevInside.current === 'ship') {
          // step down the ladder at the lander's front, facing the hatch
          const lb = st.buildings.find((x) => x.id === 'lander')
          const ang = lb ? lb.rot : 0
          const dist = 7.6
          const ex = lb ? lb.pos[0] + Math.sin(ang) * dist : 0
          const ez = lb ? lb.pos[2] + Math.cos(ang) * dist : 7.6
          fpState.pos.set(ex, heightAt(ex, ez) + EYE, ez)
          fpState.yaw = ang // face the lander (-Z local)
          fpState.vel.set(0, 0, 0)
          audio.airlock()
          emitBurst([fpState.pos.x, fpState.pos.y - 1.2, fpState.pos.z], 6, { speed: 1.6, life: 1, size: 0.3 })
        } else {
        const b = st.buildings.find((x) => x.id === prevInside.current)
        if (b && (b.type === 'shelter' || b.id === 'lander')) {
          const ang = b.id === 'lander' ? b.rot + 0.9 : b.rot + 0.5
          const dist = b.id === 'lander' ? LANDER_EXIT_DIST : 4.6
          const ex = b.pos[0] + Math.sin(ang) * dist
          const ez = b.pos[2] + Math.cos(ang) * dist
          fpState.pos.set(ex, heightAt(ex, ez) + EYE, ez)
          emitBurst([fpState.pos.x, fpState.pos.y - 1.2, fpState.pos.z], 6, { speed: 1.6, life: 1, size: 0.3 })
        }
        }
      }
      prevInside.current = st.inside
    }

    // ---------- door open/close sfx ----------
    for (const b of st.buildings) {
      const prev = prevDoors.current[b.id]
      if (prev !== undefined && prev !== b.doorOpen) {
        audio.airlock()
        const cosR = Math.cos(b.rot)
        const sinR = Math.sin(b.rot)
        emit({
          pos: [b.pos[0] + sinR * 3.2, b.pos[1] + 1.1, b.pos[2] + cosR * 3.2],
          vel: [0, 0.4, 0], life: 0.8, size: 0.3, color: '#d8d4c8', gravity: 0.4,
        })
      }
      prevDoors.current[b.id] = b.doorOpen
    }

    // ---------- footsteps ----------
    const groundSpeed = Math.hypot(fpState.vel.x, fpState.vel.z)
    fpState.speed = groundSpeed
    if (fpState.grounded && groundSpeed > 0.6) {
      stepDist.current += groundSpeed * dt
      const stride = sprint ? 2.2 : 1.7
      if (stepDist.current > stride) {
        stepDist.current = 0
        audio.footstep(st.inside ? 'metal' : 'regolith', st.inside ? 0.5 : 0.85)
      }
      fpState.walkPhase += dt * (sprint ? 11 : 8)
    } else {
      fpState.walkPhase += dt * 1.4
    }

    // ---------- interactions scan ----------
    scanTimer.current -= dt
    if (scanTimer.current <= 0) {
      scanTimer.current = 0.12
      const cands: (InteractionTarget & { score: number })[] = []
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      const consider = (t: Omit<InteractionTarget, 'score'> & { pos: [number, number, number] }, bonus: number, maxDist: number) => {
        const dx = t.pos[0] - fpState.pos.x
        const dy = t.pos[1] - fpState.pos.y
        const dz = t.pos[2] - fpState.pos.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > maxDist) return
        const dot = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / (d || 1)
        if (dot < 0.12 && d > 1.8) return
        cands.push({ ...t, score: d - bonus })
      }
      for (const b of st.buildings) {
        if (!b.built) continue
        if (b.id !== 'lander' && b.health < 85) {
          const dirToPlayer = Math.atan2(fpState.pos.x - b.pos[0], fpState.pos.z - b.pos[2])
          const fx = b.pos[0] + Math.sin(dirToPlayer) * (BUILDINGS[b.type].footprint * 0.8)
          const fz = b.pos[2] + Math.cos(dirToPlayer) * (BUILDINGS[b.type].footprint * 0.8)
          consider({
            id: `repair-${b.id}`, label: `Repair ${BUILDINGS[b.type].name} (${Math.round(b.health)}%)`,
            kind: 'repair', buildingId: b.id, pos: [fx, b.pos[1] + 1.1, fz], holdTime: 2.2,
          }, 1.1, 4.4)
        }
        for (const a of interactionAnchors(b)) {
          consider({
            id: `${a.kind}-${b.id}`, label: a.label, kind: a.kind,
            buildingId: b.id, pos: a.pos, holdTime: a.holdTime,
          }, a.kind === 'console' ? 0.5 : 0.9, 4.0)
        }
      }
      for (const ev of st.activeEvents) {
        if (ev.type === 'oxygen_leak' && ev.data.leakPos) {
          consider({
            id: ev.id, label: 'Weld emergency patch on O₂ leak', kind: 'leak',
            buildingId: ev.data.targetId ?? '', pos: ev.data.leakPos, holdTime: 2.6,
          }, 2.2, 4.6)
        }
      }
      // spaceship habitat deck anchors (real interior, buried zone)
      if (st.inside === 'ship') {
        consider({
          id: 'ship-exit', label: 'Exit the ship — return to surface (EVA)', kind: 'ship_exit',
          buildingId: 'ship', pos: shipWorldAnchor('exit'), holdTime: 0,
        }, 1.4, 4.4)
        consider({
          id: 'ship-console', label: 'Use ship operations console', kind: 'console',
          buildingId: 'ship', pos: shipWorldAnchor('opsConsole'), holdTime: 0,
        }, 0.5, 4.2)
        consider({
          id: 'ship-cryo', label: 'Check cryo bay status', kind: 'ship_info',
          buildingId: 'ship', pos: shipWorldAnchor('cryoBay'), holdTime: 0,
        }, 0.9, 4.2)
        consider({
          id: 'ship-emergency', label: 'Read emergency computer', kind: 'ship_info',
          buildingId: 'ship', pos: shipWorldAnchor('emergency'), holdTime: 0,
        }, 0.9, 4.2)
        consider({
          id: 'ship-commons', label: 'Check galley stores', kind: 'ship_info',
          buildingId: 'ship', pos: shipWorldAnchor('commons'), holdTime: 0,
        }, 0.9, 4.2)
      }
      if (!st.driving && performance.now() >= roverState.exitGuardUntil) {
        consider({
          id: 'rover', label: 'Board rover', kind: 'rover', buildingId: '',
          pos: [roverState.pos.x, roverState.pos.y + 1.3, roverState.pos.z], holdTime: 0,
        }, 0.5, 4.6)
      }
      cands.sort((a, b) => a.score - b.score)
      const best = cands[0] ?? null
      const { score: _s, ...target } = best ?? ({} as { score?: number })
      if (best) {
        st.setInteractionTarget(target as InteractionTarget)
      } else {
        st.setInteractionTarget(null)
      }
    }

    // ---------- hold E ----------
    const it = st.interaction
    fpState.reach += (((it && (input.down('KeyE') || st.interactionProgress > 0)) ? 1 : 0) - fpState.reach) * Math.min(1, dt * 6)
    if (it) {
      if (it.holdTime <= 0) {
        if (input.pressed('KeyE') && locked) {
          audio.interactBlip()
          st.completeInteraction(it.id)
        }
      } else if (input.down('KeyE') && locked) {
        const p = Math.min(1, st.interactionProgress + dt / it.holdTime)
        st.setInteractionProgress(p)
        holdSound.current -= dt
        if (holdSound.current <= 0) {
          holdSound.current = 0.45
          if (it.kind === 'repair') audio.toolWrench(0.4)
          else if (it.kind === 'leak') audio.toolWeld(0.45)
        }
        if (p >= 1) {
          audio.interactBlip()
          st.setInteractionProgress(0)
          st.completeInteraction(it.id)
        }
      } else {
        if (st.interactionProgress > 0) st.setInteractionProgress(0)
      }
    } else if (st.interactionProgress !== 0) {
      st.setInteractionProgress(0)
    }

    // ---------- camera ----------
    const bobK = Math.min(1, groundSpeed / 4)
    const bobY = Math.sin(fpState.walkPhase * 2) * 0.028 * bobK
    const bobX = Math.cos(fpState.walkPhase) * 0.02 * bobK
    camera.position.set(
      fpState.pos.x + Math.cos(fpState.yaw) * bobX,
      fpState.pos.y + bobY,
      fpState.pos.z - Math.sin(fpState.yaw) * bobX,
    )
    const euler = new THREE.Euler(fpState.pitch, fpState.yaw, Math.sin(fpState.walkPhase) * 0.006 * bobK, 'YXZ')
    camera.quaternion.setFromEuler(euler)
    // sprint FOV
    const targetFov = sprint && groundSpeed > 4 ? 80 : 75
    camFov.current += (targetFov - camFov.current) * Math.min(1, dt * 5)
    const cam = camera as THREE.PerspectiveCamera
    if (Math.abs(cam.fov - camFov.current) > 0.05) {
      cam.fov = camFov.current
      cam.updateProjectionMatrix()
    }
    // decay look velocity
    fpState.lookVel.x *= 0.75
    fpState.lookVel.y *= 0.75
    void gl
    void state
    void nextId
  })

  return null
}
