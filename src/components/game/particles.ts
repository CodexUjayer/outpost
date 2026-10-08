// Global GPU particle pool — dust, smoke, sparks, leak jets.
// Components push emissions; a single <Particles/> component renders them.
import * as THREE from 'three'

export interface ParticleSpec {
  pos: [number, number, number]
  vel: [number, number, number]
  life: number      // seconds
  size: number
  color: string
  gravity?: number  // default -1.2 (settle down); 0 = float
  drag?: number     // 0..1
}

type Slot = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
  color: THREE.Color
  gravity: number
  drag: number
}

const MAX = 1400
const slots: Slot[] = []
for (let i = 0; i < MAX; i++) {
  slots.push({
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1,
    size: 1, color: new THREE.Color(), gravity: -1.2, drag: 0.2,
  })
}
let cursor = 0

export function emit(p: ParticleSpec): void {
  const s = slots[cursor]
  cursor = (cursor + 1) % MAX
  s.pos.set(p.pos[0], p.pos[1], p.pos[2])
  s.vel.set(p.vel[0], p.vel[1], p.vel[2])
  s.life = p.life
  s.maxLife = p.life
  s.size = p.size
  s.color.set(p.color)
  s.gravity = p.gravity ?? -1.2
  s.drag = p.drag ?? 0.35
}

export function emitBurst(center: [number, number, number], count: number, opts: {
  speed?: number, life?: number, size?: number, color?: string, gravity?: number, spread?: number, up?: number
} = {}): void {
  const speed = opts.speed ?? 3
  const spread = opts.spread ?? 1
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * spread
    emit({
      pos: [center[0] + Math.cos(a) * r * 0.4, center[1] + Math.random() * 0.4, center[2] + Math.sin(a) * r * 0.4],
      vel: [Math.cos(a) * speed * (0.4 + Math.random() * 0.6), (opts.up ?? 0.6) * speed * (0.3 + Math.random()), Math.sin(a) * speed * (0.4 + Math.random() * 0.6)],
      life: (opts.life ?? 1.4) * (0.6 + Math.random() * 0.8),
      size: (opts.size ?? 0.35) * (0.6 + Math.random() * 0.9),
      color: opts.color ?? '#9a9285',
      gravity: opts.gravity,
    })
  }
}

export { slots as particleSlots, MAX as PARTICLE_MAX }
