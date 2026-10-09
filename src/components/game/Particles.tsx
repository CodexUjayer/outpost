// Dust & particle renderer — one Points mesh, plus continuous emitters
// (ambient dust drift, leaks, damaged equipment smoke, storm blowout).
'use client'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { particleSlots, PARTICLE_MAX, emit, emitBurst } from './particles'
import { useGame } from '@/game/store'
import { nextId } from '@/game/store'

const TEX = (() => {
  let tex: THREE.CanvasTexture | null = null
  return () => {
    if (tex) return tex
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.28)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    tex = new THREE.CanvasTexture(c)
    return tex
  }
})()

export default function Particles({ groundColor }: { groundColor: string }) {
  const ref = useRef<THREE.Points>(null)
  const leakHandles = useRef<Record<string, string>>({})
  const smokeAcc = useRef(0)
  const ambientAcc = useRef(0)
  const stormAcc = useRef(0)

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(PARTICLE_MAX * 3)
    const col = new Float32Array(PARTICLE_MAX * 3)
    const size = new Float32Array(PARTICLE_MAX)
    const alpha = new Float32Array(PARTICLE_MAX)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('pcolor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('psize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1))
    return g
  }, [])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: TEX() } },
    vertexShader: `
      attribute vec3 pcolor;
      attribute float psize;
      attribute float palpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = pcolor;
        vAlpha = palpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = psize * 240.0 / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, t.a * vAlpha);
        if (gl_FragColor.a < 0.01) discard;
      }
    `,
  }), [])

  useFrame((state, dt) => {
    const st = useGame.getState()
    const d = Math.min(dt, 0.1)
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const colAttr = geo.getAttribute('pcolor') as THREE.BufferAttribute
    const sizeAttr = geo.getAttribute('psize') as THREE.BufferAttribute
    const alphaAttr = geo.getAttribute('palpha') as THREE.BufferAttribute

    // integrate
    const pa = posAttr.array as Float32Array
    const ca = colAttr.array as Float32Array
    const sa = sizeAttr.array as Float32Array
    const aa = alphaAttr.array as Float32Array
    for (let i = 0; i < PARTICLE_MAX; i++) {
      const s = particleSlots[i]
      if (s.life > 0) {
        s.life -= d
        s.vel.y += s.gravity * d
        s.vel.multiplyScalar(1 - s.drag * d)
        s.pos.addScaledVector(s.vel, d)
        if (s.pos.y < 0.02) { s.pos.y = 0.02; s.vel.y = Math.abs(s.vel.y) * 0.2; s.vel.x *= 0.8; s.vel.z *= 0.8 }
        const t = Math.max(0, s.life / s.maxLife)
        pa[i * 3] = s.pos.x; pa[i * 3 + 1] = s.pos.y; pa[i * 3 + 2] = s.pos.z
        ca[i * 3] = s.color.r; ca[i * 3 + 1] = s.color.g; ca[i * 3 + 2] = s.color.b
        sa[i] = s.size * (0.5 + (1 - t) * 0.9)
        aa[i] = Math.min(1, t * 1.6)
      } else {
        aa[i] = 0
      }
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    alphaAttr.needsUpdate = true

    if (st.screen !== 'playing') return

    // --- ambient dust drift ---
    ambientAcc.current += d
    const storm = st.activeEvents.some((e) => e.type === 'dust_storm')
    const ambRate = storm ? 0.001 : 0.02
    if (ambientAcc.current > ambRate) {
      ambientAcc.current = 0
      const px = st.driving ? undefined : null
      void px
      const cam = state.camera.position
      emit({
        pos: [cam.x + (Math.random() - 0.5) * 30, 0.1 + Math.random() * 2.4, cam.z + (Math.random() - 0.5) * 30],
        vel: [1.1 + Math.random() * 0.8, 0.05, 0.3 * (Math.random() - 0.5)],
        life: 5, size: 0.22, color: groundColor, gravity: 0, drag: 0.05,
      })
    }
    // --- storm blowout ---
    if (storm) {
      stormAcc.current += d
      if (stormAcc.current > 0.004) {
        stormAcc.current = 0
        const cam = state.camera.position
        for (let i = 0; i < 5; i++) {
          emit({
            pos: [cam.x + (Math.random() - 0.5) * 40, 0.1 + Math.random() * 3.5, cam.z + (Math.random() - 0.5) * 40],
            vel: [14 + Math.random() * 8, 0.4 * Math.random(), 2 * (Math.random() - 0.5)],
            life: 2.2, size: 0.55, color: groundColor, gravity: 0, drag: 0.02,
          })
        }
      }
    }

    // --- oxygen leak jets ---
    const leaks = st.activeEvents.filter((e) => e.type === 'oxygen_leak' && e.data.leakPos)
    for (const ev of leaks) {
      const key = ev.id
      if (!leakHandles.current[key]) leakHandles.current[key] = nextId()
      if (Math.random() < d * 40) {
        emit({
          pos: ev.data.leakPos!,
          vel: [(Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6],
          life: 0.9, size: 0.16, color: '#e8f0f4', gravity: 0.4, drag: 0.1,
        })
      }
    }
    // cleanup handles for gone leaks
    for (const k of Object.keys(leakHandles.current)) {
      if (!leaks.some((e) => e.id === k)) delete leakHandles.current[k]
    }

    // --- damaged equipment smoke ---
    smokeAcc.current += d
    if (smokeAcc.current > 0.09) {
      smokeAcc.current = 0
      for (const b of st.buildings) {
        if (b.built && b.health < 45) {
          emitBurst([b.pos[0], b.pos[1] + 1.6, b.pos[2]], 1, {
            speed: 0.5, life: 2.6, size: 0.65, color: '#3f3d3a', gravity: 0.5, up: 1.6,
          })
          if (Math.random() < 0.18) {
            emitBurst([b.pos[0], b.pos[1] + 1.2, b.pos[2]], 2, {
              speed: 2.4, life: 0.5, size: 0.12, color: '#ffd890', gravity: -2,
            })
          }
        }
      }
    }
  })

  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />
}
