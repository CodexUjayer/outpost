// All building models — procedural, PBR, with interiors, animated doors,
// damage states and staged construction assembly (for cinematics).
'use client'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getMats } from './materials'
import { emit, emitBurst } from './particles'
import { BUILDINGS } from '@/game/buildings'
import type { BuildingInstance, BuildingType } from '@/game/types'
import { useGame } from '@/game/store'
import { heightAt } from '@/game/terrain'
import { LANDER_CARGO, LANDER_CEIL, LANDER_FLOOR, LANDER_HATCH_ANCHOR } from '@/game/lander'
import LanderAsset from './LanderAsset'

const easeOut = (t: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3)

/** Animated construction stage wrapper (reads progress from a ref). */
function Rise({ pRef, from, to, children, mode = 'scale' }: {
  pRef: React.MutableRefObject<number> | null
  from: number
  to: number
  children: React.ReactNode
  mode?: 'scale' | 'rise' | 'pop'
}) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!g.current) return
    const p = pRef ? pRef.current : 1
    if (p < from) {
      g.current.visible = false
      return
    }
    g.current.visible = true
    const tt = easeOut((p - from) / (to - from))
    if (mode === 'scale') {
      g.current.scale.set(0.6 + 0.4 * tt, Math.max(0.001, tt), 0.6 + 0.4 * tt)
      g.current.position.y = (1 - tt) * -0.4
    } else if (mode === 'rise') {
      g.current.scale.setScalar(Math.max(0.001, 0.85 + 0.15 * tt))
      g.current.position.y = (1 - tt) * -2.2
    } else {
      g.current.scale.setScalar(Math.max(0.001, tt))
    }
  })
  return <group ref={g}>{children}</group>
}

function StatusLight({ online, health, pos }: { online: boolean; health: number; pos: [number, number, number] }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    if (!online && health < 40) {
      ref.current.emissiveIntensity = (Math.sin(t * 9) > 0 ? 2.2 : 0.2)
      ref.current.emissive.set('#ff3020')
    } else if (!online) {
      ref.current.emissiveIntensity = 1.2
      ref.current.emissive.set('#c9722e')
    } else {
      ref.current.emissiveIntensity = (Math.sin(t * 2.2) > 0 ? 1.6 : 0.5)
      ref.current.emissive.set('#37d067')
    }
  })
  return (
    <mesh position={pos}>
      <sphereGeometry args={[0.055, 10, 8]} />
      <meshStandardMaterial ref={ref} color="#222" emissive="#37d067" emissiveIntensity={1} />
    </mesh>
  )
}

function SpinningFan({ on, pos, rot = [0, 0, 0], scale = 1 }: { on: boolean; pos: [number, number, number]; rot?: [number, number, number]; scale?: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ref.current && on) ref.current.rotation.z += dt * 9
  })
  return (
    <group position={pos} rotation={rot as unknown as THREE.Euler} scale={scale}>
      <group ref={ref}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[0.09, 0, 0]}>
            <boxGeometry args={[0.2, 0.045, 0.02]} />
            <meshStandardMaterial color="#777" roughness={0.5} metalness={0.4} />
          </mesh>
        ))}
      </group>
      <mesh>
        <torusGeometry args={[0.2, 0.02, 6, 18]} />
        <meshStandardMaterial color="#555" roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  )
}

// ================================================================
// LANDER
// ================================================================
export function Lander({ b }: { b: BuildingInstance }) {
  const m = getMats()
  const damaged = b.health < 40
  return (
    <group position={b.pos} rotation={[0, b.rot, damaged ? 0.012 : 0]}>
      {/* the user's realistic-lander asset — 6× the astronaut model */}
      <LanderAsset />

      {/* EVA ladder up to the cabin hatch (front = +Z) */}
      <group position={[0, 0.15, 5.02]} rotation={[0.17, 0, 0]}>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 3.05, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 6.1, 8]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
        ))}
        {[0.5, 1.15, 1.8, 2.45, 3.1, 3.75, 4.4, 5.05, 5.7].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.028, 0.028, 0.6, 6]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
        ))}
      </group>
      {/* platform bridging ladder top → hatch */}
      <mesh position={[0, 6.02, 4.3]} rotation={[0.17, 0, 0]} castShadow>
        <boxGeometry args={[0.95, 0.07, 1.75]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>

      {/* round cabin hatch on the front wall */}
      <mesh position={[0, 6.72, 3.34]}>
        <circleGeometry args={[0.56, 20]} />
        <meshStandardMaterial color="#23262b" roughness={0.45} metalness={0.6} />
      </mesh>
      <mesh position={[0, 6.72, 3.31]}>
        <torusGeometry args={[0.6, 0.05, 8, 24]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>

      <LanderInterior online={b.online} />
      <StatusLight online={b.online} health={b.health} pos={[1.1, 5.5, 4.4]} />

      {/* deployable spare-solar cargo pallet (interaction point) */}
      <group position={[LANDER_CARGO[0], 0, LANDER_CARGO[2]]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[1.9, 1.0, 1.5]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
        <mesh position={[0, 1.06, 0]} rotation={[0.12, 0, 0]} castShadow>
          <boxGeometry args={[1.66, 0.06, 1.16]} />
          <primitive object={m.solarCell} attach="material" />
        </mesh>
        <mesh position={[0, 1.03, 0]} rotation={[0.12, 0, 0]}>
          <boxGeometry args={[1.72, 0.03, 1.22]} />
          <primitive object={m.solarFrame} attach="material" />
        </mesh>
      </group>
    </group>
  )
}

// ================================================================
// LANDER CABIN INTERIOR — walkable when the player enters via the hatch
// ================================================================
function LanderInterior({ online }: { online: boolean }) {
  const m = getMats()
  const F = LANDER_FLOOR
  const H = LANDER_CEIL - LANDER_FLOOR
  const R = 3.06
  return (
    <group>
      {/* floor + ceiling */}
      <mesh position={[0, F, 0]} receiveShadow>
        <cylinderGeometry args={[R, R, 0.1, 24]} />
        <meshStandardMaterial color="#4b4e53" roughness={0.75} metalness={0.4} />
      </mesh>
      <mesh position={[0, F + H, 0]}>
        <cylinderGeometry args={[R, R, 0.12, 24]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.8} metalness={0.3} />
      </mesh>
      {/* wall shell — gaps toward +Z form the two cockpit windows */}
      <mesh position={[0, F + H / 2, 0]}>
        <cylinderGeometry args={[R + 0.04, R + 0.04, H - 0.12, 28, 1, true, 0.75, Math.PI * 2 - 1.74]} />
        <meshStandardMaterial color="#33363b" roughness={0.88} metalness={0.25} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, F + H / 2, 0]}>
        <cylinderGeometry args={[R + 0.04, R + 0.04, H - 0.12, 8, 1, true, Math.PI * 2 - 0.13, 0.24]} />
        <meshStandardMaterial color="#33363b" roughness={0.88} metalness={0.25} side={THREE.BackSide} />
      </mesh>
      {/* tinted window panes (see-through, framed by the shell gaps) */}
      {[-0.435, 0.435].map((th) => (
        <mesh
          key={th}
          position={[Math.sin(th) * (R + 0.02), F + 1.85, Math.cos(th) * (R + 0.02)]}
          rotation={[0, th, 0]}
        >
          <planeGeometry args={[1.5, 0.85]} />
          <meshStandardMaterial
            color="#10161c"
            roughness={0.08}
            metalness={0.9}
            transparent
            opacity={0.3}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* angled flight console under the windows */}
      <group position={[0.4, F, 2.3]} rotation={[0, -0.25, 0]}>
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[2.0, 0.1, 0.6]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
        <mesh position={[0, 1.38, 0.2]} rotation={[-0.5, 0, 0]}>
          <boxGeometry args={[1.9, 0.5, 0.06]} />
          <primitive object={online ? m.screenOn : m.screenOff} attach="material" />
        </mesh>
        {[-0.55, 0.55].map((x) => (
          <mesh key={x} position={[x, 1.13, 0.02]}>
            <boxGeometry args={[0.5, 0.06, 0.24]} />
            <meshStandardMaterial color="#2b2e33" roughness={0.7} metalness={0.3} />
          </mesh>
        ))}
      </group>
      {/* crew seats */}
      {[-0.95, 0.95].map((x) => (
        <group key={x} position={[x, F, 0.9]}>
          <mesh position={[0, 0.35, 0]}>
            <boxGeometry args={[0.55, 0.5, 0.5]} />
            <meshStandardMaterial color="#2e3136" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.85, -0.22]}>
            <boxGeometry args={[0.55, 0.75, 0.12]} />
            <meshStandardMaterial color="#2e3136" roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* aft equipment rack */}
      <mesh position={[-2.15, F + 0.95, -1.3]}>
        <boxGeometry args={[1.0, 1.7, 0.45]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      {/* interior side of the hatch */}
      <mesh position={[0, 6.72, R - 0.02]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.56, 20]} />
        <meshStandardMaterial color="#1b1e22" roughness={0.5} metalness={0.55} />
      </mesh>
      <pointLight position={[0, F + 2.35, 0]} color="#ffe9cf" intensity={online ? 2.6 : 0.3} distance={10} decay={1.6} />
    </group>
  )
}


// ================================================================
// SOLAR ARRAY (sun-tracking)
// ================================================================
export function SolarArray({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const tracking = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!tracking.current) return
    const st = useGame.getState()
    const dayFrac = 0.68
    const prog = THREE.MathUtils.clamp((st.timeOfDay - 0.02) / dayFrac, 0, 1)
    const target = st.screen === 'menu' ? 0.5 : THREE.MathUtils.lerp(-1.55, 1.55, prog)
    tracking.current.rotation.y += (target - tracking.current.rotation.y) * Math.min(1, 0.02)
    void state
  })
  const body = (
    <group>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.8, 1.0, 0.24, 10]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 1.3, 8]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <group ref={tracking} position={[0, 1.42, 0]}>
        <mesh rotation={[0.62, 0, 0]} castShadow>
          <boxGeometry args={[3.6, 0.08, 1.9]} />
          <primitive object={m.solarFrame} attach="material" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.94, 0.045 * Math.cos(0.62) * 0 + 0.07 * Math.sin(0.62), -0.4 * Math.cos(0.62) * s * 0 - Math.sin(0.62) * 0]} rotation={[0.62, 0, 0]} castShadow>
            <boxGeometry args={[1.72, 0.06, 1.78]} />
            <primitive object={m.solarCell} attach="material" />
          </mesh>
        ))}
        {/* back struts */}
        <mesh position={[0, -0.18, 0.2]} rotation={[0.9, 0, 0]}>
          <boxGeometry args={[0.06, 0.9, 0.06]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      </group>
      <StatusLight online={b.online} health={b.health} pos={[0.5, 0.28, 0.4]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return (
    <group position={b.pos} rotation={[0, b.rot, 0]}>
      <Rise pRef={progressRef} from={0} to={0.5}>{body}</Rise>
    </group>
  )
}

// ================================================================
// BATTERY BANK
// ================================================================
export function BatteryBank({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const body = (
    <group>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[2.2, 1.1, 1.3]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.55, 0.55, -0.68]}>
          <boxGeometry args={[0.7, 0.8, 0.06]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      ))}
      <mesh position={[0, 1.14, 0]}>
        <boxGeometry args={[2.24, 0.08, 1.34]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      {[-0.6, 0, 0.6].map((x, i) => (
        <mesh key={i} position={[x, 0.35, 0.67]}>
          <boxGeometry args={[0.16, 0.16, 0.04]} />
          <meshStandardMaterial color="#181a1c" emissive={b.online ? '#37d067' : '#c93020'} emissiveIntensity={b.online ? 1.4 : 1} />
        </mesh>
      ))}
      <mesh position={[0.9, 0.12, 0.4]} rotation={[0, 0.4, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 1.4, 6]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <StatusLight online={b.online} health={b.health} pos={[-0.8, 1.2, 0.5]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.7}>{body}</Rise></group>
}

// ================================================================
// STORAGE DEPOT
// ================================================================
export function Depot({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const body = (
    <group>
      <mesh position={[0, 0.65, 0]} castShadow>
        <boxGeometry args={[3.0, 1.3, 1.5]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <mesh position={[0.2, 1.95, 0]} rotation={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[2.6, 1.2, 1.4]} />
        <primitive object={m.accentOrange} attach="material" />
      </mesh>
      {[-1, 0, 1].map((x, i) => (
        <mesh key={i} position={[x * 1.0, 0.65, 0.76]}>
          <boxGeometry args={[0.5, 0.7, 0.03]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      ))}
      <mesh position={[-0.9, 0.02, 0.9]} rotation={[0, 0.3, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 6]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <StatusLight online={b.online} health={b.health} pos={[1.3, 1.35, 0.6]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.7}>{body}</Rise></group>
}

// ================================================================
// HABITAT — pressurized cylinder with airlock + furnished interior
// ================================================================
const HAB_R = 3.0
const HAB_WALL_H = 2.25
const DOOR_HALF = 0.48

export function Habitat({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const doorRef = useRef<THREE.Group>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const fanOn = b.online && b.health > 40

  useFrame((_, dt) => {
    if (doorRef.current) {
      const target = b.doorOpen ? -1.7 : 0
      doorRef.current.rotation.y += (target - doorRef.current.rotation.y) * Math.min(1, dt * 3)
    }
    if (lightRef.current) {
      const st = useGame.getState()
      const lit = b.built && b.online && b.health > 40
      const insideHere = st.inside === b.id
      lightRef.current.intensity = lit ? (insideHere ? 2.6 : 1.2) : 0
    }
  })

  const structure = (
    <group>
      {/* plinth */}
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[HAB_R + 0.35, HAB_R + 0.5, 0.28, 24]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* floor */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[HAB_R - 0.05, HAB_R - 0.05, 0.1, 24]} />
        <meshStandardMaterial color="#6b6862" roughness={0.85} />
      </mesh>
      {/* wall with door gap (gap centered on +z) */}
      <mesh position={[0, 0.3 + HAB_WALL_H / 2, 0]} castShadow>
        <cylinderGeometry args={[HAB_R, HAB_R, HAB_WALL_H, 28, 1, true, DOOR_HALF, Math.PI * 2 - DOOR_HALF * 2]} />
        <primitive object={m.hullWhiteBack} attach="material" />
      </mesh>
      {/* dome */}
      <mesh position={[0, 0.3 + HAB_WALL_H, 0]} castShadow>
        <sphereGeometry args={[HAB_R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <primitive object={m.hullWhiteBack} attach="material" />
      </mesh>
      {/* interior wall liner */}
      <mesh position={[0, 0.3 + HAB_WALL_H / 2, 0]}>
        <cylinderGeometry args={[HAB_R - 0.12, HAB_R - 0.12, HAB_WALL_H - 0.06, 24, 1, true, DOOR_HALF, Math.PI * 2 - DOOR_HALF * 2]} />
        <meshStandardMaterial color="#b9b6ac" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      {/* regolith berm ring (radiation shielding) */}
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[HAB_R + 0.75, HAB_R + 1.15, 0.75, 24]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* airlock door */}
      <group position={[0, 0.3, 0]}>
        <mesh position={[0, HAB_WALL_H / 2, HAB_R + 0.18]}>
          <torusGeometry args={[0.62, 0.09, 8, 20]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
        <group ref={doorRef} position={[Math.sin(DOOR_HALF) * HAB_R, 0, Math.cos(DOOR_HALF) * HAB_R]}>
          <mesh position={[-0.52, HAB_WALL_H / 2, 0]} castShadow>
            <boxGeometry args={[1.04, 1.32, 0.09]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
          <mesh position={[-0.86, HAB_WALL_H / 2, 0.07]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 8]} />
            <primitive object={m.hullDark} attach="material" />
          </mesh>
        </group>
      </group>
      {/* exterior details */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 2.2, 1.9, -1.5]}>
          <boxGeometry args={[0.9, 0.75, 0.08]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      ))}
      <mesh position={[-HAB_R - 0.02, 0.3 + 1.6, -0.6]} rotation={[0, -Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 1.6, 8]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <SpinningFan on={fanOn} pos={[2.05, 1.6, -1.42]} rot={[0, -2.2, 0]} scale={1.4} />
      <StatusLight online={b.online} health={b.health} pos={[0, HAB_WALL_H + 0.55, HAB_R - 0.4]} />
      {/* interior lights */}
      <pointLight ref={lightRef} position={[0, 2.2, 0]} color="#f2ead8" distance={7.5} intensity={0} />
      <mesh position={[0, HAB_WALL_H + 0.28, 0]}>
        <boxGeometry args={[1.7, 0.05, 0.5]} />
        <meshStandardMaterial color="#fff8e8" emissive="#f5ecd4" emissiveIntensity={b.online && b.health > 40 ? 1.4 : 0} />
      </mesh>
    </group>
  )

  const interior = (
    <group>
      {/* bunks */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.95, 0, -0.9]} rotation={[0, s * Math.PI / 2.4, 0]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.75, 0.1, 1.9]} />
            <primitive object={m.fabric} attach="material" />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <boxGeometry args={[0.7, 0.42, 1.86]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
          <mesh position={[0, 0.68, -0.8]}>
            <boxGeometry args={[0.55, 0.14, 0.35]} />
            <meshStandardMaterial color="#8f8a7c" roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* console opposite door */}
      <group position={[0, 0, -2.2]}>
        <mesh position={[0, 0.85, 0]} castShadow>
          <boxGeometry args={[1.7, 1.1, 0.55]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
        <mesh position={[0, 1.18, 0.16]} rotation={[-0.35, 0, 0]}>
          <boxGeometry args={[1.4, 0.62, 0.05]} />
          <primitive object={b.online && b.health > 40 ? m.screenOn : m.screenOff} attach="material" />
        </mesh>
        <mesh position={[0, 1.42, -0.05]}>
          <boxGeometry args={[1.5, 0.06, 0.4]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      </group>
      {/* lockers */}
      <group position={[-1.9, 0, 1.6]} rotation={[0, 0.8, 0]}>
        <mesh position={[0, 0.9, 0]} castShadow>
          <boxGeometry args={[0.6, 1.8, 1.1]} />
          <primitive object={m.hullWhite} attach="material" />
        </mesh>
        {[-0.35, 0.35].map((y, i) => (
          <mesh key={i} position={[0.31, 0.9 + y, 0]}>
            <boxGeometry args={[0.02, 0.5, 0.9]} />
            <primitive object={m.hullDark} attach="material" />
          </mesh>
        ))}
      </group>
      {/* table + stool */}
      <mesh position={[0.7, 0.72, 0.8]}>
        <cylinderGeometry args={[0.45, 0.45, 0.05, 16]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <mesh position={[0.7, 0.38, 0.8]}>
        <cylinderGeometry args={[0.06, 0.09, 0.72, 8]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      {/* plant (life) */}
      <group position={[-0.5, 0.76, 0.85]}>
        <mesh>
          <cylinderGeometry args={[0.14, 0.11, 0.24, 10]} />
          <primitive object={m.concrete} attach="material" />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.7) * 0.08, 0.24, Math.sin(i * 1.7) * 0.08]} rotation={[0.4, i, 0]}>
            <coneGeometry args={[0.09, 0.34, 6]} />
            <primitive object={m.plantGreen} attach="material" />
          </mesh>
        ))}
      </group>
    </group>
  )

  if (!progressRef) {
    return (
      <group position={b.pos} rotation={[0, b.rot, 0]}>
        {structure}
        {interior}
      </group>
    )
  }
  return (
    <group position={b.pos} rotation={[0, b.rot, 0]}>
      <Rise pRef={progressRef} from={0} to={0.45} mode="scale">{structure}</Rise>
      <Rise pRef={progressRef} from={0.45} to={0.9} mode="rise">{interior}</Rise>
    </group>
  )
}

// ================================================================
// GREENHOUSE
// ================================================================
export function Greenhouse({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const lit = b.online && b.health > 40
  const interior = (
    <group>
      {[0, 1, 2].map((row) => (
        <group key={row} position={[(row - 1) * 1.15, 0, 0]}>
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[0.85, 0.8, 4.6]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
          <mesh position={[0, 0.82, 0]}>
            <boxGeometry args={[0.75, 0.08, 4.4]} />
            <meshStandardMaterial color="#4a3b30" roughness={0.95} />
          </mesh>
          {[-1.7, -0.6, 0.5, 1.6].map((z, i) => (
            <group key={i} position={[0, 0.86, z]}>
              {[0, 1, 2].map((k) => (
                <mesh key={k} position={[k * 0.24 - 0.24, 0.16, 0]} rotation={[0, 0, 0.15 + k * 0.12]}>
                  <coneGeometry args={[0.12, 0.36, 6]} />
                  <primitive object={m.plantGreen} attach="material" />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* grow lamps */}
      {[-1.4, 0, 1.4].map((z, i) => (
        <mesh key={i} position={[0, 2.15, z]}>
          <boxGeometry args={[3.2, 0.05, 0.3]} />
          <meshStandardMaterial color="#ffe9c8" emissive="#ffdfae" emissiveIntensity={lit ? 1.6 : 0} />
        </mesh>
      ))}
      <pointLight position={[0, 1.9, 0]} color="#ffdfae" intensity={lit ? 1.4 : 0} distance={7} />
    </group>
  )
  const structure = (
    <group>
      {/* floor slab */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[7.2, 0.2, 5.4]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* half cylinder shell along X */}
      <mesh position={[0, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[2.5, 2.5, 6.8, 24, 1, true, Math.PI, Math.PI]} />
        <primitive object={m.glassHabitat} attach="material" />
      </mesh>
      {/* end caps */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 3.4, 0.2 + 1.25, 0]} rotation={[0, s * Math.PI / 2, 0]}>
          <circleGeometry args={[2.5, 24, Math.PI, Math.PI]} />
          <primitive object={m.glassHabitat} attach="material" />
        </mesh>
      ))}
      {/* base walls */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.55, s * 2.5]}>
          <boxGeometry args={[6.8, 0.7, 0.12]} />
          <primitive object={m.hullWhite} attach="material" />
        </mesh>
      ))}
      {/* frame ribs */}
      {[-2.4, -1.2, 0, 1.2, 2.4].map((x, i) => (
        <mesh key={i} position={[x, 1.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.48, 0.045, 6, 24, Math.PI]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
      ))}
      {/* equipment box + tank */}
      <mesh position={[-3.0, 0.6, -1.6]} castShadow>
        <boxGeometry args={[0.8, 0.9, 1.2]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <SpinningFan on={b.online && b.health > 40} pos={[-3.0, 1.15, -1.0]} rot={[Math.PI / 2, 0, 0]} />
      <StatusLight online={b.online} health={b.health} pos={[3.3, 1.0, 1.8]} />
    </group>
  )
  if (!progressRef) {
    return <group position={b.pos} rotation={[0, b.rot, 0]}>{structure}{interior}</group>
  }
  return (
    <group position={b.pos} rotation={[0, b.rot, 0]}>
      <Rise pRef={progressRef} from={0} to={0.5} mode="scale">{structure}</Rise>
      <Rise pRef={progressRef} from={0.5} to={0.9} mode="rise">{interior}</Rise>
    </group>
  )
}

// ================================================================
// ICE EXTRACTOR
// ================================================================
export function Extractor({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const drillRef = useRef<THREE.Group>(null)
  const working = b.online && b.health > 40
  useFrame((state, dt) => {
    if (drillRef.current && working) {
      const t = state.clock.elapsedTime
      drillRef.current.position.y = 0.9 + Math.sin(t * 2.4) * 0.45
      drillRef.current.rotation.y += dt * 14
    }
  })
  const body = (
    <group>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[2.6, 0.36, 2.2]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      <mesh position={[0.6, 1.05, -0.3]} castShadow>
        <boxGeometry args={[1.5, 1.5, 1.3]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <mesh position={[0.6, 1.85, -0.3]}>
        <boxGeometry args={[1.56, 0.1, 1.36]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <SpinningFan on={working} pos={[1.15, 1.35, 0.37]} rot={[0, 0, 0]} scale={1.1} />
      {/* drill mast */}
      <mesh position={[-0.7, 1.6, 0.2]}>
        <boxGeometry args={[0.16, 3.0, 0.16]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <mesh position={[-0.7, 3.0, -0.25]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.12, 1.0, 0.12]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <group ref={drillRef} position={[-0.7, 0.9, 0.2]}>
        <mesh>
          <cylinderGeometry args={[0.1, 0.14, 1.0, 8]} />
          <primitive object={m.darkMetal} attach="material" />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.3, 8]} />
          <primitive object={m.accentOrange} attach="material" />
        </mesh>
      </group>
      {/* water tank */}
      <mesh position={[-1.6, 0.85, -1.1]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 1.4, 14]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <mesh position={[-1.6, 1.6, -1.1]}>
        <sphereGeometry args={[0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      {/* hose */}
      <mesh position={[-1.0, 0.5, -0.6]} rotation={[0, 0.7, Math.PI / 3]}>
        <cylinderGeometry args={[0.06, 0.06, 1.4, 8]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <StatusLight online={b.online} health={b.health} pos={[1.2, 0.42, 0.8]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.7} mode="scale">{body}</Rise></group>
}

// ================================================================
// OXYGEN GENERATOR
// ================================================================
export function OxygenGen({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const working = b.online && b.health > 40
  const body = (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[2.4, 0.3, 1.8]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      <mesh position={[-0.4, 0.75, -0.2]} castShadow>
        <boxGeometry args={[1.2, 0.9, 1.1]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      {/* electrolyzer stacks */}
      {[0.35, 1.05].map((x, i) => (
        <group key={i} position={[x, 0.95, 0.35]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.28, 0.28, 1.3, 12]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
          <mesh position={[0, 0.68, 0]}>
            <sphereGeometry args={[0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <primitive object={m.hullWhite} attach="material" />
          </mesh>
          {[0.25, 0.55, 0.85].map((y, j) => (
            <mesh key={j} position={[0, y - 0.4, 0.285]}>
              <boxGeometry args={[0.5, 0.06, 0.02]} />
              <primitive object={m.hullDark} attach="material" />
            </mesh>
          ))}
        </group>
      ))}
      {/* pipes */}
      <mesh position={[0.7, 0.5, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 1.2, 8]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <mesh position={[0.05, 0.5, -0.2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.4, 8]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      {/* radiator */}
      <mesh position={[0, 1.28, -0.2]}>
        <boxGeometry args={[1.9, 0.5, 0.07]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <SpinningFan on={working} pos={[0.55, 1.0, -0.78]} rot={[0, Math.PI, 0]} scale={1.2} />
      <StatusLight online={b.online} health={b.health} pos={[-0.9, 0.42, 0.7]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.7} mode="scale">{body}</Rise></group>
}

// ================================================================
// COMMS TOWER
// ================================================================
export function CommsTower({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const dishRef = useRef<THREE.Group>(null)
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((state, dt) => {
    if (dishRef.current && b.online) dishRef.current.rotation.y += dt * 0.12
    if (beaconRef.current) {
      beaconRef.current.emissiveIntensity = Math.sin(state.clock.elapsedTime * 2.4) > 0.6 ? 2.4 : 0.15
    }
  })
  const body = (
    <group>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.9, 1.1, 0.24, 10]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 3.2, 8]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.5, 1.0, 0]} rotation={[0, 0, s * 0.5]}>
          <cylinderGeometry args={[0.03, 0.03, 1.5, 6]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
      ))}
      <group ref={dishRef} position={[0, 3.35, 0]}>
        <mesh rotation={[-0.9, 0, 0]} castShadow>
          <sphereGeometry args={[0.85, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
          <meshStandardMaterial color="#d4d4d0" roughness={0.35} metalness={0.55} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.35, 0.55]} rotation={[-0.9, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.7, 6]} />
          <primitive object={m.hullDark} attach="material" />
        </mesh>
      </group>
      <mesh position={[0, 3.55, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial ref={beaconRef} color="#300" emissive="#ff4030" emissiveIntensity={1} />
      </mesh>
      {/* equipment box */}
      <mesh position={[0.7, 0.4, 0.5]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.5]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <StatusLight online={b.online} health={b.health} pos={[-0.6, 0.3, 0.5]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return (
    <group position={b.pos} rotation={[0, b.rot, 0]}>
      <Rise pRef={progressRef} from={0} to={0.4} mode="scale">{body}</Rise>
      <Rise pRef={progressRef} from={0.4} to={0.95} mode="rise">
        <group position={[0, -1.7, 0]}>{body}</group>
      </Rise>
    </group>
  )
}

// ================================================================
// RESEARCH LAB
// ================================================================
export function Lab({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const lit = b.online && b.health > 40
  const body = (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[3.6, 0.3, 2.6]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[3.4, 1.7, 2.3]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <mesh position={[0, 2.05, 0]}>
        <boxGeometry args={[3.44, 0.1, 2.34]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      {/* window strip */}
      <mesh position={[0, 1.5, 1.16]}>
        <boxGeometry args={[2.6, 0.5, 0.06]} />
        <meshStandardMaterial color="#181d22" roughness={0.15} metalness={0.6} emissive={lit ? '#b8c8a0' : '#000'} emissiveIntensity={lit ? 0.5 : 0} />
      </mesh>
      {/* door */}
      <mesh position={[1.2, 0.85, 1.16]}>
        <boxGeometry args={[0.7, 1.1, 0.05]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      {/* antenna + dish */}
      <mesh position={[-1.2, 2.6, -0.6]}>
        <cylinderGeometry args={[0.02, 0.02, 1.0, 6]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <mesh position={[-1.2, 3.05, -0.6]} rotation={[1.2, 0, 0]}>
        <sphereGeometry args={[0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
        <meshStandardMaterial color="#cfcfcf" roughness={0.4} metalness={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* solar foot */}
      <mesh position={[-2.2, 0.55, 0.6]} rotation={[0, 0.4, -0.5]} castShadow>
        <boxGeometry args={[1.1, 0.05, 0.8]} />
        <primitive object={m.solarCell} attach="material" />
      </mesh>
      <SpinningFan on={lit} pos={[1.4, 1.6, -1.17]} rot={[0, Math.PI, 0]} scale={1.1} />
      <StatusLight online={b.online} health={b.health} pos={[-1.5, 2.15, 0.8]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.75} mode="scale">{body}</Rise></group>
}

// ================================================================
// STORM SHELTER (buried dome)
// ================================================================
export function Shelter({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const hatchRef = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (hatchRef.current) {
      const st = useGame.getState()
      const open = st.inside === b.id || b.doorOpen
      const target = open ? -1.9 : 0
      hatchRef.current.rotation.x += (target - hatchRef.current.rotation.x) * Math.min(1, dt * 2.5)
    }
  })
  const body = (
    <group>
      <mesh position={[0, -0.35, 0]}>
        <sphereGeometry args={[2.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* berm */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[3.4, 4.2, 0.55, 20]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* hatch */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.7, 0.75, 0.35, 12]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <group ref={hatchRef} position={[0, 0.95, 0.6]}>
        <mesh position={[0, 0.06, -0.3]} castShadow>
          <boxGeometry args={[0.85, 0.1, 0.85]} />
          <primitive object={m.hullGray} attach="material" />
        </mesh>
      </group>
      {/* ladder rungs + vent */}
      <mesh position={[0.9, 0.5, -0.9]}>
        <cylinderGeometry args={[0.08, 0.08, 0.6, 8]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <SpinningFan on={b.online && b.health > 40} pos={[0.9, 0.85, -0.9]} rot={[Math.PI / 2, 0, 0]} scale={0.9} />
      <StatusLight online={b.online} health={b.health} pos={[-0.9, 0.7, 0.9]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.7} mode="scale">{body}</Rise></group>
}

// ================================================================
// ISRU REFINERY
// ================================================================
export function Refinery({ b, progressRef }: { b: BuildingInstance; progressRef?: React.MutableRefObject<number> | null }) {
  const m = getMats()
  const working = b.online && b.health > 40
  const smokeAcc = useRef(0)
  useFrame((_, dt) => {
    if (working && Math.random() < dt * 6) {
      emit({
        pos: [b.pos[0] + Math.sin(b.rot) * 0 + 0.2, b.pos[1] + 3.4, b.pos[2] + 0.2],
        vel: [0.4 + Math.random() * 0.3, 1.4 + Math.random(), 0.1],
        life: 2.8, size: 0.5, color: '#6a6259', gravity: 0.6, drag: 0.1,
      })
    }
    void smokeAcc
  })
  const body = (
    <group>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[3.4, 0.32, 2.6]} />
        <primitive object={m.concrete} attach="material" />
      </mesh>
      {/* kiln drum */}
      <mesh position={[0, 1.15, -0.3]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.75, 0.75, 2.8, 16]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <mesh position={[0.9, 1.15, -0.3]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.78, 0.78, 0.5, 16]} />
        <meshStandardMaterial color="#c9722e" roughness={0.5} metalness={0.4} emissive={working ? '#c95010' : '#000'} emissiveIntensity={working ? 0.55 : 0} />
      </mesh>
      {/* hopper */}
      <mesh position={[-0.7, 2.2, -0.3]} castShadow>
        <cylinderGeometry args={[0.5, 0.18, 0.9, 10]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      <mesh position={[-0.7, 2.85, -0.3]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[1.1, 0.5, 1.1]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      {/* stack */}
      <mesh position={[0.2, 2.6, -0.3]}>
        <cylinderGeometry args={[0.12, 0.16, 2.2, 8]} />
        <primitive object={m.hullGray} attach="material" />
      </mesh>
      {/* output bin */}
      <mesh position={[1.2, 0.65, 0.9]} castShadow>
        <boxGeometry args={[1.1, 0.9, 1.1]} />
        <primitive object={m.accentOrange} attach="material" />
      </mesh>
      {/* conveyor */}
      <mesh position={[-0.2, 1.15, 0.8]} rotation={[0, 0, 0.12]}>
        <boxGeometry args={[2.2, 0.1, 0.5]} />
        <primitive object={m.hullDark} attach="material" />
      </mesh>
      <SpinningFan on={working} pos={[-1.45, 1.0, 0.9]} rot={[0, 1.2, 0]} scale={1.2} />
      <StatusLight online={b.online} health={b.health} pos={[1.6, 1.15, 0.4]} />
    </group>
  )
  if (!progressRef) return <group position={b.pos} rotation={[0, b.rot, 0]}>{body}</group>
  return <group position={b.pos} rotation={[0, b.rot, 0]}><Rise pRef={progressRef} from={0} to={0.75} mode="scale">{body}</Rise></group>
}

// ================================================================
// Router
// ================================================================
export function BuildingView({ b }: { b: BuildingInstance }) {
  if (!b.built) return null
  switch (b.type) {
    case 'solar': return <SolarArray b={b} />
    case 'battery': return <BatteryBank b={b} />
    case 'depot': return b.id === 'lander' ? <Lander b={b} /> : <Depot b={b} />
    case 'habitat': return <Habitat b={b} />
    case 'greenhouse': return <Greenhouse b={b} />
    case 'extractor': return <Extractor b={b} />
    case 'oxygen': return <OxygenGen b={b} />
    case 'comms': return <CommsTower b={b} />
    case 'lab': return <Lab b={b} />
    case 'shelter': return <Shelter b={b} />
    case 'refinery': return <Refinery b={b} />
    default: return null
  }
}

/** Model for construction cinematics (progress 0..1). */
export function ConstructionModel({ type, pos, rot, progressRef }: { type: BuildingType; pos: [number, number, number]; rot: number; progressRef: React.MutableRefObject<number> }) {
  const ghost: BuildingInstance = useMemo(() => ({
    id: 'construction', type, pos, rot, health: 100, online: false, doorOpen: false, built: true,
  }), [type, pos, rot])
  const puffs = useRef({ s0: false, s1: false, s2: false })
  useFrame(() => {
    const progress = progressRef.current
  void progress
  if (puffs.current.s0 === false && progressRef.current > 0.05) {
      puffs.current.s0 = true
      emitBurst([pos[0], pos[1] + 0.2, pos[2]], 10, { speed: 2.5, life: 1.4, size: 0.5 })
    }
    if (puffs.current.s1 === false && progressRef.current > 0.5) {
      puffs.current.s1 = true
      emitBurst([pos[0], pos[1] + 1.2, pos[2]], 14, { speed: 3, life: 1.6, size: 0.6 })
    }
    if (puffs.current.s2 === false && progressRef.current > 0.9) {
      puffs.current.s2 = true
      emitBurst([pos[0], pos[1] + 1.6, pos[2]], 10, { speed: 2, life: 1.2, size: 0.4 })
    }
  })
  const g = { b: ghost, progressRef }
  return (
    <group>
      {/* foundation pad */}
      <mesh position={[pos[0], pos[1] + 0.06, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[BUILDINGS[type].footprint * 0.95, 24]} />
        <meshStandardMaterial color="#8f8a80" roughness={0.95} />
      </mesh>
      {type === 'solar' && <SolarArray {...g} />}
      {type === 'battery' && <BatteryBank {...g} />}
      {type === 'depot' && <Depot {...g} />}
      {type === 'habitat' && <Habitat {...g} />}
      {type === 'greenhouse' && <Greenhouse {...g} />}
      {type === 'extractor' && <Extractor {...g} />}
      {type === 'oxygen' && <OxygenGen {...g} />}
      {type === 'comms' && <CommsTower {...g} />}
      {type === 'lab' && <Lab {...g} />}
      {type === 'shelter' && <Shelter {...g} />}
      {type === 'refinery' && <Refinery {...g} />}
    </group>
  )
}

/** World-space interaction anchor points for a building. */
export function interactionAnchors(b: BuildingInstance): {
  kind: 'door' | 'console' | 'cargo_solar' | 'shelter'
  pos: [number, number, number]
  label: string
  holdTime: number
}[] {
  const cos = Math.cos(b.rot)
  const sin = Math.sin(b.rot)
  const local = (lx: number, ly: number, lz: number): [number, number, number] => [
    b.pos[0] + lx * cos + lz * sin,
    b.pos[1] + ly,
    b.pos[2] + -lx * sin + lz * cos,
  ]
  const st = useGame.getState()
  const out: { kind: 'door' | 'console' | 'cargo_solar' | 'shelter'; pos: [number, number, number]; label: string; holdTime: number }[] = []
  if (b.type === 'habitat') {
    out.push({
      kind: 'door',
      pos: local(0, 1.0, HAB_R + 0.7),
      label: b.doorOpen ? 'Close airlock hatch' : 'Open airlock hatch',
      holdTime: 0,
    })
    if (st.inside === b.id) {
      out.push({
        kind: 'console',
        pos: local(0, 1.0, -1.7),
        label: 'Use habitat console',
        holdTime: 0,
      })
    }
  }
  if (b.type === 'shelter') {
    out.push({
      kind: 'shelter',
      pos: local(0, 1.1, 0),
      label: st.inside === b.id ? 'Climb out of shelter' : 'Enter storm shelter',
      holdTime: 0,
    })
  }
  if (b.id === 'lander') {
    out.push({
      kind: 'shelter',
      pos: local(LANDER_HATCH_ANCHOR[0], LANDER_HATCH_ANCHOR[1], LANDER_HATCH_ANCHOR[2]),
      label: st.inside === b.id ? 'Exit lander cabin (EVA)' : 'Board the ship — habitat deck',
      holdTime: 0,
    })
  }
  if (b.id === 'lander' && st.phase === 1 && !st.buildings.some((x) => x.type === 'solar' && x.built)) {
    out.push({
      kind: 'cargo_solar',
      pos: local(LANDER_CARGO[0], 0.75, LANDER_CARGO[2]),
      label: 'Deploy spare solar array',
      holdTime: 0,
    })
  }
  return out
}

export { heightAt }
