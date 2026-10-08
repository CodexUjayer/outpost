// Landing cinematic — powered descent on the real lander asset, engine fire,
// dust blast, touchdown, crew radio.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { audio } from '@/game/audio'
import { emitBurst, emit } from './particles'
import { heightAt } from '@/game/terrain'
import { fpState } from './Player'
import LanderAsset from './LanderAsset'
import EnginePlume from './Plume'

const DURATION = 16.5
const TOUCH_T = 13.6

export default function LandingCinematic() {
  const { camera } = useThree()
  const tRef = useRef(0)
  const lander = useRef<THREE.Group>(null)
  const plume = useRef<THREE.Group>(null)
  const plumeLight = useRef<THREE.PointLight>(null)
  const groundGlow = useRef<THREE.Mesh>(null)
  const groundLight = useRef<THREE.PointLight>(null)
  const radioFlags = useRef<Record<number, boolean>>({})
  const touched = useRef(false)

  useEffect(() => {
    audio.landingBurn(true)
    return () => {
      audio.landingBurn(false)
      audio.setConstructionMotor(false, 0)
    }
  }, [])

  useFrame((_, dtRaw) => {
    const st = useGame.getState()
    if (st.screen !== 'landing') return
    const dt = Math.min(dtRaw, 0.05)
    tRef.current += dt
    const t = tRef.current
    const p = Math.min(1, t / TOUCH_T)
    const alt = Math.pow(1 - p, 1.75) * 115
    const y = heightAt(0, 0) + alt

    if (lander.current) {
      lander.current.position.y = y
      // slow tumble that settles — rotation eases back to 0 so the world
      // lander (rot 0) matches at control hand-off
      lander.current.rotation.y = 0.8 * (1 - THREE.MathUtils.smoothstep(p, 0.5, 1))
      lander.current.rotation.z = (1 - p) * 0.02 * Math.sin(t * 0.8)
    }
    // engine fire — long plume, flaring as it nears the surface
    const burning = t < TOUCH_T
    if (plume.current) {
      plume.current.visible = burning
      if (burning) {
        const flick = 0.9 + Math.random() * 0.25
        const len = THREE.MathUtils.clamp(alt * 0.16, 2.8, 16)
        plume.current.scale.set(flick, len, flick)
        plume.current.position.y = 0.95
      }
    }
    if (plumeLight.current) {
      plumeLight.current.visible = burning
      plumeLight.current.intensity = burning ? 60 + Math.random() * 30 : 0
    }
    // engine wash hitting the surface — glow + light grow as it descends
    const near = burning ? THREE.MathUtils.clamp(1 - alt / 26, 0, 1) : 0
    if (groundLight.current) {
      groundLight.current.visible = near > 0.02
      groundLight.current.intensity = near * (110 + Math.random() * 50)
    }
    if (groundGlow.current) {
      groundGlow.current.visible = near > 0.02
      const gm = groundGlow.current.material as THREE.MeshBasicMaterial
      gm.opacity = near * (0.5 + Math.random() * 0.22)
      const s = 0.85 + (1 - near) * 0.5
      groundGlow.current.scale.set(s, s, s)
    }
    // dust kicked by engine wash (radial storm as thrust nears the ground)
    if (burning && alt < 30) {
      const strength = 1 - alt / 30
      if (Math.random() < 0.95) {
        const a = Math.random() * Math.PI * 2
        const r = 4 + (1 - strength) * 17 * Math.random()
        emit({
          pos: [Math.cos(a) * r, heightAt(Math.cos(a) * r, Math.sin(a) * r) + 0.25, Math.sin(a) * r],
          vel: [Math.cos(a) * (5 + strength * 12), 1.0 + Math.random() * 1.8, Math.sin(a) * (5 + strength * 12)],
          life: 2.6, size: 1.0, color: '#a09a8e', gravity: -0.4, drag: 0.15,
        })
      }
    }
    // touchdown
    if (!touched.current && t >= TOUCH_T) {
      touched.current = true
      audio.landingBurn(false)
      audio.touchdown()
      audio.thud(1)
      fpState.shake = 1.4
      emitBurst([0, heightAt(0, 0) + 0.4, 0], 70, { speed: 12, life: 2.8, size: 1.0, color: '#a89f90', up: 0.55 })
    }
    // radio script
    const lines: [number, string][] = [
      [0.6, 'Mission Control: Final descent. Throttle up — trust the guidance loop.'],
      [5.5, 'Descent stage: 60 meters. Velocity nominal.'],
      [9.5, 'Descent stage: 20 meters. Dust cloud developing below.'],
      [TOUCH_T + 0.8, 'Mission Control: Contact light. Engine shutdown. Welcome to the surface.'],
      [TOUCH_T + 3.2, 'Mission Control: We are go for base camp deployment. Set up solar first — everything else depends on it.'],
    ]
    for (const [tt, text] of lines) {
      if (t >= tt && !radioFlags.current[tt]) {
        radioFlags.current[tt] = true
        st.radio(text)
        audio.radioBlip()
        audio.radioVoice(2.4)
      }
    }
    // camera: slow dolly + handheld noise, shake on touch
    const shake = Math.max(0, fpState.shake) * (Math.random() - 0.5)
    const camX = THREE.MathUtils.lerp(34, 23, Math.min(1, t / DURATION))
    const camZ = THREE.MathUtils.lerp(45, 30, Math.min(1, t / DURATION))
    const camY = THREE.MathUtils.lerp(8.5, 3.6, Math.min(1, t / DURATION))
    camera.position.set(
      camX + Math.sin(t * 0.7) * 0.25 + shake * 0.4,
      camY + Math.sin(t * 1.1) * 0.15 + shake * 0.4,
      camZ + Math.cos(t * 0.5) * 0.25 + shake * 0.4,
    )
    camera.lookAt(0, y * 0.55 + 2.4 + shake * 0.2, 0)
    fpState.shake *= Math.max(0, 1 - dt * 2.2)

    // hand off control — the INTREPID mission film plays next, then gameplay
    if (t >= DURATION) {
      audio.success()
      st.setScreen('cutscene')
    }
  })

  return (
    <group>
      <group ref={lander} position={[0, 115, 0]}>
        {/* the real lander — 6× the astronaut model */}
        <LanderAsset />
        {/* engine fire (extends -Y from the bell) */}
        <group ref={plume} position={[0, 0.95, 0]}>
          <EnginePlume />
        </group>
        <pointLight ref={plumeLight} position={[0, -1.2, 0]} color="#ffc070" intensity={70} distance={170} decay={2} />
      </group>
      {/* surface effects under the descent path */}
      <mesh ref={groundGlow} position={[0, heightAt(0, 0) + 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[7.5, 32]} />
        <meshBasicMaterial color="#ffb35c" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={groundLight} position={[0, heightAt(0, 0) + 1.4, 0]} color="#ffb35c" intensity={0} distance={60} decay={2} visible={false} />
    </group>
  )
}
