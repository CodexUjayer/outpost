// ShipInterior — the real Spaceship.blend habitat deck (interior.glb), placed
// in a buried zone and lit by restrained engineering lighting. Mounts lazily on
// first boarding, stays mounted (visible only while inside) so the BVH caches
// and GPU buffers persist.
'use client'
import { Suspense, useMemo, useEffect } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { SHIP_MODEL_URL, SHIP_ZONE, installBVHRaycast, registerShipMeshes } from '@/game/shipInterior'

// start streaming the GLB as soon as this module is imported in the browser
if (typeof window !== 'undefined') {
  useLoader.preload(GLTFLoader, SHIP_MODEL_URL)
}

function ShipModel() {
  const gltf = useLoader(GLTFLoader, SHIP_MODEL_URL)
  const model = useMemo(() => {
    installBVHRaycast()
    const src = gltf.scene
    const clone = src.clone(true)
    const meshes: THREE.Mesh[] = []
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (mat && 'envMapIntensity' in mat) {
        mat.envMapIntensity = 0.55
      }
      const geo = mesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree: (o?: object) => void }
      if (!geo.boundsTree) geo.computeBoundsTree({ targetLeafSize: 8 })
      meshes.push(mesh)
    })
    registerShipMeshes(meshes)
    return clone
  }, [gltf])
  return <primitive object={model} />
}

/**
 * Restrained interior lighting: cool-white LED wash per compartment (matching
 * the model's own emissive strip positions) plus one soft warm accent over the
 * console bank. No colored sci-fi washes.
 */
function ShipLights() {
  return (
    <group>
      {/* ambient fill so nothing reads pure black */}
      <ambientLight intensity={0.08} color="#cfd6dd" />
      {/* central hall */}
      <pointLight position={[0, 2.95, 1]} intensity={1.6} distance={20} decay={2} color="#eef2f4" />
      {/* north corridor + console bank */}
      <pointLight position={[0, 2.9, 9]} intensity={1.4} distance={14} decay={2} color="#e8edf2" />
      <pointLight position={[0, 2.55, -5.6]} intensity={1.2} distance={12} decay={2} color="#ffe9cf" />
      {/* south airlock module */}
      <pointLight position={[0, 2.7, 9.8]} intensity={1.6} distance={12} decay={2} color="#dfe8f0" />
      {/* west wing (cryo bay / emergency station) */}
      <pointLight position={[-6, 2.9, 0.5]} intensity={1.6} distance={16} decay={2} color="#e6ecf2" />
      {/* east wing (galley commons) */}
      <pointLight position={[6, 2.9, 0.5]} intensity={1.6} distance={16} decay={2} color="#e6ecf2" />
      {/* soft mid-deck fill — evens the falloff without hot spots */}
      <pointLight position={[-3, 2.2, -3]} intensity={0.6} distance={18} decay={2} color="#e9edf1" />
      <pointLight position={[3, 2.2, 4]} intensity={0.6} distance={18} decay={2} color="#e9edf1" />
    </group>
  )
}

export default function ShipInterior({ visible }: { visible: boolean }) {
  useEffect(() => {
    return () => {
      // nothing to dispose — geometry/buffers persist for the next boarding
    }
  }, [])
  return (
    <group
      position={[SHIP_ZONE.x, SHIP_ZONE.y, SHIP_ZONE.z]}
      visible={visible}
    >
      <Suspense fallback={null}>
        <ShipModel />
      </Suspense>
      <ShipLights />
    </group>
  )
}
