// Construction cinematic — cargo rover delivers, robotic arm assembles the
// structure in stages, weld sparks fly, camera orbits then returns to the player.
'use client'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { audio } from '@/game/audio'
import { ConstructionModel } from './Buildings'
import { getMats } from './materials'
import { emitBurst } from './particles'
import { fpState } from './Player'
import { heightAt } from '@/game/terrain'
import { BUILDINGS } from '@/game/buildings'
import { RoverModel } from './Rover'

export default function ConstructionCinematic() {
  const { camera } = useThree()
  const tRef = useRef(0)
  const started = useRef(false)
  const startCamPos = useRef(new THREE.Vector3())
  const cue = useRef({ arrived: false, crane: false, weldT: 0, done: false })
  const roverRef = useRef<THREE.Group>(null)
  const armBase = useRef<THREE.Group>(null)
  const armSeg1 = useRef<THREE.Group>(null)
  const armSeg2 = useRef<THREE.Group>(null)
  const m = getMats()

  const c = useGame((s) => s.construction)

  useEffect(() => {
    if (!started.current) {
      started.current = true
      startCamPos.current.copy(camera.position)
    }
    audio.setConstructionMotor(true, 0.2)
    audio.constructorCue(0)
    return () => {
      audio.setConstructionMotor(false, 0)
    }
  }, [camera])

  useFrame((_, dtRaw) => {
    const st = useGame.getState()
    if (!st.construction) return
    const cc = st.construction
    // skip requested? (store sets t = dur)
    if (cc.t >= cc.dur) {
      tRef.current = cc.dur
    } else {
      tRef.current += Math.min(dtRaw, 0.05)
    }
    const dur = cc.dur
    const tt = tRef.current
    const p = Math.min(1, tt / dur)
    // sync store skip state
    if (cc.t >= cc.dur && tt < cc.dur) tRef.current = cc.dur

    const site = new THREE.Vector3(cc.pos[0], cc.pos[1], cc.pos[2])
    const fp = BUILDINGS[cc.type].footprint
    const landerPos = new THREE.Vector3(0, heightAt(0, 0), 0)

    // assembly progress window
    const asmP = THREE.MathUtils.clamp((p - 0.3) / 0.55, 0, 1)

    // ---- cargo rover path ----
    const driveDir = site.clone().sub(landerPos).normalize()
    const parkPos = site.clone().addScaledVector(driveDir, -(fp + 5.5))
    const home = landerPos.clone().add(new THREE.Vector3(10, 0, 8))
    let roverPos: THREE.Vector3
    let roverHeading: number
    if (p < 0.3) {
      const q = THREE.MathUtils.smoothstep(p / 0.3, 0, 1)
      roverPos = home.clone().lerp(parkPos, q)
      roverHeading = Math.atan2(driveDir.x, driveDir.z)
      if (q > 0.05 && q < 0.98 && Math.random() < 0.5) {
        emitBurst([roverPos.x, roverPos.y + 0.2, roverPos.z], 1, { speed: 1.6, life: 1.2, size: 0.35, color: '#9a8f80', up: 0.5 })
      }
      if (!cue.current.arrived && q >= 0.99) {
        cue.current.arrived = true
        audio.constructorCue(1)
      }
      audio.setConstructionMotor(true, 0.5 + Math.sin(tt * 3) * 0.2)
    } else if (p < 0.85) {
      roverPos = parkPos
      roverHeading = Math.atan2(driveDir.x, driveDir.z)
      audio.setConstructionMotor(true, 0.35 + asmP * 0.45)
    } else {
      const q = THREE.MathUtils.smoothstep((p - 0.85) / 0.14, 0, 1)
      roverPos = parkPos.clone().lerp(home, q)
      roverHeading = Math.atan2(-driveDir.x, -driveDir.z)
      audio.setConstructionMotor(true, 0.6)
      if (!cue.current.done && q >= 0.6) {
        cue.current.done = true
        audio.constructorCue(3)
      }
    }
    if (roverRef.current) {
      roverRef.current.position.set(roverPos.x, heightAt(roverPos.x, roverPos.z) + 0.05, roverPos.z)
      roverRef.current.rotation.y = roverHeading
    }

    // ---- crane arm ----
    if (armBase.current) {
      const targetYaw = p < 0.3 ? 0 : Math.atan2(site.x - roverPos.x, site.z - roverPos.z) - roverHeading
      armBase.current.rotation.y += (targetYaw - armBase.current.rotation.y) * Math.min(1, 0.06)
    }
    if (armSeg1.current && armSeg2.current) {
      const working = p >= 0.3 && p < 0.86
      const ext = working ? 0.5 + Math.sin(tt * 1.4) * 0.12 : 0.12
      armSeg1.current.rotation.x += ((working ? -1.05 : -0.25) - armSeg1.current.rotation.x) * Math.min(1, 0.05)
      armSeg2.current.rotation.x += ((working ? -0.75 - ext * 0.5 : -0.15) - armSeg2.current.rotation.x) * Math.min(1, 0.05)
    }

    // ---- weld sparks + sfx during assembly ----
    if (p >= 0.34 && p < 0.86) {
      cue.current.weldT -= dtRaw
      if (cue.current.weldT <= 0) {
        cue.current.weldT = 0.5 + Math.random() * 0.6
        audio.toolWeld(0.45)
        const sx = site.x + (Math.random() - 0.5) * fp
        const sz = site.z + (Math.random() - 0.5) * fp
        const sy = site.y + 0.4 + asmP * 2.2
        emitBurst([sx, sy, sz], 5, { speed: 2.6, life: 0.55, size: 0.1, color: '#ffcf80', gravity: -3 })
        if (Math.random() < 0.3) emitBurst([sx, sy, sz], 3, { speed: 1.4, life: 1.2, size: 0.4, color: '#8b8579' })
      }
      if (!cue.current.crane && p > 0.32) {
        cue.current.crane = true
        audio.constructorCue(2)
      }
    }

    // ---- camera path ----
    const orbitAng = 0.9 + p * 1.5
    const orbitR = fp + 7.5
    const orbitPos = new THREE.Vector3(
      site.x + Math.sin(orbitAng) * orbitR,
      site.y + 3.6 + Math.sin(p * 5) * 0.5,
      site.z + Math.cos(orbitAng) * orbitR,
    )
    let camPos: THREE.Vector3
    let look: THREE.Vector3
    if (p < 0.12) {
      const q = THREE.MathUtils.smoothstep(p / 0.12, 0, 1)
      camPos = startCamPos.current.clone().lerp(orbitPos, q)
      look = startCamPos.current.clone().multiplyScalar(1 - q).addScaledVector(site.clone().add(new THREE.Vector3(0, 1.4, 0)), q)
    } else if (p < 0.9) {
      camPos = orbitPos
      look = site.clone().add(new THREE.Vector3(0, 1.2 + asmP * 0.8, 0))
    } else {
      const q = THREE.MathUtils.smoothstep((p - 0.9) / 0.1, 0, 1)
      camPos = orbitPos.clone().lerp(startCamPos.current, q)
      look = site.clone().add(new THREE.Vector3(0, 1.4, 0)).multiplyScalar(1 - q).add(
        fpState.pos.clone().multiplyScalar(q).add(new THREE.Vector3(0, 0, 0)),
      )
    }
    camera.position.lerp(camPos, Math.min(1, 0.14))
    const m4 = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0))
    const q4 = new THREE.Quaternion().setFromRotationMatrix(m4)
    camera.quaternion.slerp(q4, Math.min(1, 0.12))

    // ---- finish ----
    if (tt >= dur) {
      audio.success()
      st.finishConstruction()
    }
  })

  if (!c) return null

  return (
    <group>
      <ConstructionModel type={c.type} pos={c.pos} rot={c.rot} progressRef={tRef} />
      {/* construction rover with robotic arm */}
      <group ref={roverRef}>
        <RoverModel parked={false} />
        <group ref={armBase} position={[0, 1.5, 0.9]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.22, 0.4, 10]} />
            <primitive object={m.hullDark} attach="material" />
          </mesh>
          <group ref={armSeg1} position={[0, 0.2, 0]}>
            <mesh position={[0, 0.7, 0]} castShadow>
              <boxGeometry args={[0.18, 1.5, 0.18]} />
              <primitive object={m.accentOrange} attach="material" />
            </mesh>
            <group ref={armSeg2} position={[0, 1.4, 0]}>
              <mesh position={[0, 0.55, 0]} castShadow>
                <boxGeometry args={[0.14, 1.1, 0.14]} />
                <primitive object={m.hullGray} attach="material" />
              </mesh>
              <mesh position={[0, 1.1, 0]}>
                <boxGeometry args={[0.24, 0.16, 0.24]} />
                <primitive object={m.hullDark} attach="material" />
              </mesh>
              {/* weld head glow */}
              <mesh position={[0, 1.2, 0]}>
                <sphereGeometry args={[0.05, 8, 6]} />
                <meshStandardMaterial color="#ffb050" emissive="#ff9020" emissiveIntensity={1.6} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}
