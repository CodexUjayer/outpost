// Astronaut model system — loads the uploaded GLB astronaut (public/models/astronaut.glb)
// and provides:
//   loadAstronautScene()  — cached loader for the raw source scene
//   cloneAstronaut()      — SkeletonUtils clone, normalized to ~1.78 m, feet at y=0
//   findBone()            — exact-name bone lookup
//   AstronautFigure       — full-body NPC that plays the idle animation (colony crew)
//   Crew                  — population-driven crew figures placed around the colony
//
// GLB facts (used below):
//   - ~206 units tall (cm); head-center / eye height ≈ y 188
//   - meshes split by body part: Object_7/9 arms, Object_11 head, Object_13/15 legs, Object_17 torso
//   - skeleton: CC_Base_* joints; arms: CC_Base_{L,R}_Upperarm/Forearm/Hand
//   - single 10.55s idle motion clip ("TempMotion")
'use client'
import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { heightAt } from '@/game/terrain'
import { useGame } from '@/game/store'

export const ASTRONAUT_URL = '/models/astronaut.glb'

// body-part mesh names in the GLB
export const ASTRONAUT_MESHES = {
  armR: 'Object_7',
  armL: 'Object_9',
  head: 'Object_11',
  legR: 'Object_13',
  legL: 'Object_15',
  torso: 'Object_17',
} as const

// CC_Base bone names (exact — avoid the *_scaleCompensation wrappers)
export const ASTRONAUT_BONES = {
  upperR: 'CC_Base_R_Upperarm_074',
  foreR: 'CC_Base_R_Forearm_077',
  handR: 'CC_Base_R_Hand_081',
  upperL: 'CC_Base_L_Upperarm_050',
  foreL: 'CC_Base_L_Forearm_051',
  handL: 'CC_Base_L_Hand_055',
  thighR: 'CC_Base_R_Thigh_00',
  calfR: 'CC_Base_R_Calf_021',
  thighL: 'CC_Base_L_Thigh_04',
  calfL: 'CC_Base_L_Calf_05',
} as const

let loadPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null

/** Cached load of the raw astronaut scene (clone it via cloneAstronaut). */
export function loadAstronautScene() {
  if (!loadPromise) {
    loadPromise = new GLTFLoader()
      .loadAsync(ASTRONAUT_URL)
      .then((g) => {
        // debug probe (used by browser automation to inspect the rig)
        ;(window as unknown as { __astro?: unknown }).__astro = {
          scene: g.scene,
          animations: g.animations ?? [],
          THREE: THREE,
        }
        return { scene: g.scene, animations: g.animations ?? [] }
      })
      .catch((e) => {
        loadPromise = null
        console.warn('[astronaut] failed to load GLB', e)
        throw e
      })
  }
  return loadPromise
}

// kick off the download as early as possible (menu screen covers the wait)
if (typeof window !== 'undefined') void loadAstronautScene().catch(() => {})

export interface AstronautClone {
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  eyeY: number // eye height in meters at the clone's scale
  height: number // total height in meters
}

/** Clone + normalize: uniform scale (~1.78 m tall), feet at y=0, optional idle animation.
 *  animClip lets callers pass a filtered/prepared clip instead of animations[0]. */
export function cloneAstronaut(
  src: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  opts?: { idle?: boolean; animWeight?: number; animOffset?: number; animClip?: THREE.AnimationClip },
): AstronautClone {
  const model = skeletonClone(src.scene) as THREE.Group
  // Sketchfab export ships materials with metalness=1 and no env map → renders black.
  // Clamp to believable EVA-suit fabric/metal values.
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial
        if (std.metalness !== undefined) std.metalness = Math.min(std.metalness, 0.32)
        if (std.roughness !== undefined) std.roughness = Math.max(std.roughness, 0.5)
        if (std.envMapIntensity !== undefined) std.envMapIntensity = 0.7
        std.needsUpdate = true
      }
    }
  })

  // measure from RAW geometry bounding boxes. Box3.setFromObject() would use the
  // skinned/posed bounding box, which is unreliable on a freshly cloned skeleton
  // (it returned ~0.02 units for this model → 86x scale explosion).
  model.updateWorldMatrix(true, true)
  const box = new THREE.Box3()
  const tmpBox = new THREE.Box3()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      tmpBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
      box.union(tmpBox)
    }
  })
  const rawHeight = box.isEmpty() ? 0 : box.max.y - box.min.y
  // known-good fallback: this model is ~206.3 units tall at rest pose
  const safeHeight = rawHeight > 0.5 && rawHeight < 1000 ? rawHeight : 206.3

  // normalize
  const s = 1.78 / safeHeight
  model.scale.setScalar(s)
  model.position.y = -box.min.y * s

  const outer = new THREE.Group()
  outer.name = 'astroRoot'
  outer.add(model)

  // eye height from the head mesh's raw geometry
  const head = model.getObjectByName(ASTRONAUT_MESHES.head) as THREE.Mesh | undefined
  let eyeY = safeHeight * s * 0.915
  if (head && head.geometry) {
    if (!head.geometry.boundingBox) head.geometry.computeBoundingBox()
    tmpBox.copy(head.geometry.boundingBox!).applyMatrix4(head.matrixWorld)
    if (tmpBox.min.y < tmpBox.max.y) eyeY = ((tmpBox.min.y + tmpBox.max.y) / 2) * s
  }

  let mixer: THREE.AnimationMixer | null = null
  if (opts?.idle && src.animations && src.animations.length) {
    mixer = new THREE.AnimationMixer(model)
    const action = mixer.clipAction(opts.animClip ?? src.animations[0])
    action.play()
    action.setEffectiveWeight(opts.animWeight ?? 1)
    if (opts.animOffset) mixer.setTime(opts.animOffset)
  }

  return { root: outer, mixer, eyeY, height: safeHeight * s }
}

/** Exact-name bone finder. */
export function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null
  root.traverse((o) => {
    if (!found && o.name === name && (o as THREE.Bone).isBone) found = o as THREE.Bone
  })
  return found
}

// ================================================================
// Crew figure — full body + idle animation, standing in the colony
// ================================================================
function useAstronautSource(): { scene: THREE.Group; animations: THREE.AnimationClip[] } | null {
  const [src, setSrc] = useState<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>(null)
  useEffect(() => {
    let live = true
    loadAstronautScene()
      .then((s) => {
        if (live) setSrc(s)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return src
}

function AstronautFigure({ pos, rotY, phase = 0 }: { pos: [number, number, number]; rotY: number; phase?: number }) {
  const src = useAstronautSource()
  const clone = useMemo(() => {
    if (!src) return null
    const c = cloneAstronaut(src, { idle: true, animWeight: 1, animOffset: phase * 10.55 })
    // crew cast real shadows
    c.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = false
      }
    })
    return c
  }, [src, phase])

  useFrame((_, dt) => {
    if (!clone) return
    const st = useGame.getState()
    const vis = st.screen === 'playing'
    clone.root.visible = vis
    if (vis && clone.mixer) clone.mixer.update(Math.min(dt, 0.05))
  })

  if (!clone) return null
  return <primitive object={clone.root} position={pos} rotation={[0, rotY, 0]} />
}

// ================================================================
// Crew — visible colony population (you are never alone out here)
// ================================================================
export function Crew() {
  const buildings = useGame((s) => s.buildings)
  const pop = useGame((s) => s.population)

  const spots = useMemo(() => {
    const out: { pos: [number, number, number]; rotY: number }[] = []
    const ground = (x: number, z: number): [number, number, number] => [x, heightAt(x, z), z]
    // 1 — crewmate at the lander since touchdown
    out.push({ pos: ground(3.6, 4.6), rotY: Math.PI * 1.15 })
    // 2 — engineer by the habitat door
    const hab = buildings.find((b) => b.type === 'habitat')
    if (hab && pop >= 2) {
      const dx = Math.sin(hab.rot) * 3.4
      const dz = Math.cos(hab.rot) * 3.4
      out.push({ pos: ground(hab.pos[0] + dx, hab.pos[2] + dz), rotY: hab.rot + Math.PI + 0.5 })
    }
    // 3 — botanist tending the greenhouse
    const gh = buildings.find((b) => b.type === 'greenhouse')
    if (gh && pop >= 4) {
      out.push({ pos: ground(gh.pos[0] + 2.6, gh.pos[2] + 1.8), rotY: gh.rot + Math.PI * 0.75 })
    }
    // 4 — technician inspecting the power grid
    const sol = buildings.find((b) => b.type === 'solar' && b.id !== 'lander')
    if (sol && pop >= 6) {
      out.push({ pos: ground(sol.pos[0] - 2.2, sol.pos[2] + 1.6), rotY: sol.rot - 0.6 })
    }
    return out
  }, [buildings, pop])

  return (
    <>
      {spots.map((sp, i) => (
        <AstronautFigure key={i} pos={sp.pos} rotY={sp.rotY} phase={i * 0.37 + 0.2} />
      ))}
    </>
  )
}
