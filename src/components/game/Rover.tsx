// Cargo rover — real NASA/JPL Curiosity model (converted GLB) + drivable vehicle (third-person).
// Wheels spin with speed; front + rear corner wheels steer (rocker-bogie style opposite phase).
'use client'
import { Suspense, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { emit } from './particles'
import { useGame } from '@/game/store'
import { heightAt } from '@/game/terrain'
import { input } from '@/game/input'
import { audio } from '@/game/audio'

export const ROVER_START: [number, number, number] = [10, 0, 7]

// Shared mutable rover state (position/heading/speed) for camera + interactions
export const roverState = {
  pos: new THREE.Vector3(ROVER_START[0], heightAt(ROVER_START[0], ROVER_START[2]), ROVER_START[2]),
  heading: 0.6,
  speed: 0,
  // performance.now() until which re-boarding is suppressed (prevents same-frame exit→re-enter)
  exitGuardUntil: 0,
}

const MAX_SPEED = 11
const MAX_REVERSE = 4
const WHEEL_RADIUS = 0.25 // real Curiosity wheel Ø 0.5 m

// ---- converted NASA model ----
export const ROVER_MODEL_URL = '/models/rover/curiosity.glb'
useLoader.preload(GLTFLoader, ROVER_MODEL_URL)

type WheelId = 'FL' | 'FR' | 'ML' | 'MR' | 'RL' | 'RR'
const WHEEL_NAMES: Record<WheelId, string> = {
  FL: 'front_left', FR: 'front_right', ML: 'mid_left', MR: 'mid_right', RL: 'rear_left', RR: 'rear_right',
}
// wheel disc centers measured from the converted model (meters, +Z = forward)
const WHEEL_CENTERS: Record<WheelId, [number, number, number]> = {
  FL: [-0.9756, 0.25, 1.0348], FR: [0.9756, 0.25, 1.0348],
  ML: [-1.1617, 0.25, -0.0499], MR: [1.1617, 0.25, -0.0499],
  RL: [-0.9672, 0.25, -0.9679], RR: [0.9672, 0.25, -0.9679],
}
const WHEEL_ORDER: WheelId[] = ['FL', 'FR', 'ML', 'MR', 'RL', 'RR']
// corner wheels steer; rear pair counters the front (like Curiosity's AKB)
const STEER_SIGN: Record<WheelId, number> = { FL: 1, FR: 1, ML: 0, MR: 0, RL: -1, RR: -1 }

function useRoverParts() {
  const gltf = useLoader(GLTFLoader, ROVER_MODEL_URL) as unknown as { scene: THREE.Group }
  return useMemo(() => {
    const byName = new Map<string, THREE.Object3D>()
    gltf.scene.traverse((o) => { if (o.name) byName.set(o.name, o) })
    const grab = (name: string) => {
      const o = byName.get(name)
      if (!o) throw new Error(`rover.glb missing node ${name}`)
      const c = o.clone(true)
      c.traverse((m) => {
        const mesh = m as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true; mesh.receiveShadow = false
          // the scene's ambient env is dim; boost it on the rover so the
          // white painted body + metals read correctly instead of going black
          const mat = mesh.material as THREE.MeshStandardMaterial | undefined
          if (mat && 'envMapIntensity' in mat) {
            mat.envMapIntensity = 1.5
            mat.needsUpdate = true
          }
        }
      })
      return c
    }
    const body = grab('body')
    const wheels = {} as Record<WheelId, THREE.Object3D>
    for (const id of WHEEL_ORDER) wheels[id] = grab(`wheel_${WHEEL_NAMES[id]}`)
    return { body, wheels }
  }, [gltf])
}

// Static parked rover (cinematics) — same real model.
export function RoverModel({ parked = true, steering = 0 }: { parked?: boolean; steering?: number }) {
  void parked; void steering
  const parts = useRoverParts()
  return (
    <group>
      <primitive object={parts.body} />
      {WHEEL_ORDER.map((id) => (
        <group key={id} position={WHEEL_CENTERS[id]}>
          <primitive
            object={parts.wheels[id]}
            position={[-WHEEL_CENTERS[id][0], -WHEEL_CENTERS[id][1], -WHEEL_CENTERS[id][2]]}
          />
        </group>
      ))}
    </group>
  )
}

export default function Rover() {
  const group = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group[]>([])
  const steers = useRef<THREE.Group[]>([])
  const steerVal = useRef(0)

  useFrame((state, dtRaw) => {
    const st = useGame.getState()
    const dt = Math.min(dtRaw, 0.05)
    const g = group.current
    if (!g) return
    const driving = st.driving && st.screen === 'playing' && !st.paused && !st.construction

    if (driving) {
      // ---- drive ----
      const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0)
      const turn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0)
      const target = fwd > 0 ? MAX_SPEED : fwd < 0 ? -MAX_REVERSE : 0
      roverState.speed += (target - roverState.speed) * Math.min(1, dt * 1.6)
      if (Math.abs(roverState.speed) > 0.05) {
        const steerAmt = turn * dt * 1.1 * (roverState.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(roverState.speed) / 4 + 0.35)
        roverState.heading += steerAmt
      }
      const vx = Math.sin(roverState.heading) * roverState.speed
      const vz = Math.cos(roverState.heading) * roverState.speed
      const nx = roverState.pos.x + vx * dt
      const nz = roverState.pos.z + vz * dt
      // keep rover in world bounds
      const d = Math.sqrt(nx * nx + nz * nz)
      if (d < 140) {
        roverState.pos.x = nx
        roverState.pos.z = nz
      } else {
        roverState.speed *= 0.5
      }
      // dust behind wheels
      if (Math.abs(roverState.speed) > 3 && Math.random() < dt * 30) {
        emit({
          pos: [roverState.pos.x - Math.sin(roverState.heading) * 2.2 + (Math.random() - 0.5), roverState.pos.y + 0.15, roverState.pos.z - Math.cos(roverState.heading) * 2.2 + (Math.random() - 0.5), ],
          vel: [(Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.4],
          life: 1.6, size: 0.4, color: '#9a8f80', gravity: -0.6,
        })
      }
      audio.setRoverEngine(true, Math.min(1, Math.abs(roverState.speed) / MAX_SPEED))
      if (input.pressed('KeyE')) {
        st.exitRover()
        roverState.exitGuardUntil = performance.now() + 900
        audio.setRoverEngine(false, 0)
        audio.doorServo()
      }
    } else {
      roverState.speed *= 0.9
      if (Math.abs(roverState.speed) < 0.05) audio.setRoverEngine(false, 0)
    }

    // terrain follow with pitch/roll
    const hC = heightAt(roverState.pos.x, roverState.pos.z)
    const hF = heightAt(roverState.pos.x + Math.sin(roverState.heading) * 1.4, roverState.pos.z + Math.cos(roverState.heading) * 1.4)
    const hR = heightAt(roverState.pos.x + Math.cos(roverState.heading) * 0.9, roverState.pos.z - Math.sin(roverState.heading) * 0.9)
    roverState.pos.y += (hC - roverState.pos.y) * Math.min(1, dt * 8)
    const pitch = Math.atan2(hF - hC, 1.4)
    const roll = Math.atan2(hR - hC, 0.9)
    g.position.copy(roverState.pos)
    g.rotation.set(0, 0, 0)
    g.rotateY(roverState.heading)
    g.rotateX(-pitch * 0.7)
    g.rotateZ(roll * 0.5)

    // wheel spin (rolling contact: ω = v / r) + steering visuals —
    // ONLY while actually driving (wheels used to twitch when walking
    // because steering read global A/D input unconditionally)
    if (driving) {
      spin.current.forEach((w) => { if (w) w.rotation.x += (roverState.speed * dt) / WHEEL_RADIUS })
      const steerTarget = (input.down('KeyA') ? 0.5 : input.down('KeyD') ? -0.5 : 0)
      steerVal.current += (steerTarget - steerVal.current) * Math.min(1, dt * 6)
      steers.current.forEach((s, i) => {
        if (s) s.rotation.y = steerVal.current * STEER_SIGN[WHEEL_ORDER[i]]
      })
    } else {
      // wheels settle straight when parked
      steerVal.current *= Math.max(0, 1 - dt * 4)
      steers.current.forEach((s, i) => {
        if (s) s.rotation.y = steerVal.current * STEER_SIGN[WHEEL_ORDER[i]]
      })
    }
    void state
  })

  return (
    <group ref={group} position={roverState.pos}>
      <Suspense fallback={null}>
        <RoverDrivable spinRef={spin} steerRef={steers} />
      </Suspense>
    </group>
  )
}

function RoverDrivable({
  spinRef, steerRef,
}: { spinRef: React.MutableRefObject<THREE.Group[]>; steerRef: React.MutableRefObject<THREE.Group[]> }) {
  const parts = useRoverParts()
  return (
    <group>
      <primitive object={parts.body} />
      {WHEEL_ORDER.map((id, i) => (
        <group
          key={id}
          position={WHEEL_CENTERS[id]}
          ref={(el) => { if (el && STEER_SIGN[id] !== 0) steerRef.current[i] = el }}
        >
          <group ref={(el) => { if (el) spinRef.current[i] = el }}>
            <primitive
              object={parts.wheels[id]}
              position={[-WHEEL_CENTERS[id][0], -WHEEL_CENTERS[id][1], -WHEEL_CENTERS[id][2]]}
            />
          </group>
        </group>
      ))}
    </group>
  )
}
