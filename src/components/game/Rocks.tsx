// Instanced rocks & boulders scattered across the terrain.
'use client'
import { useMemo } from 'react'
import * as THREE from 'three'
import { heightAt, hash2, FLAT_RADIUS } from '@/game/terrain'
import type { Planet } from '@/game/types'
import { PLANETS } from '@/game/types'

const COUNT = 220

export default function Rocks({ planet }: { planet: Planet }) {
  const { geo, mat, matrixArr, colorArr } = useMemo(() => {
    const cfg = PLANETS[planet]
    // base geometry: noisy icosahedron
    const g = new THREE.IcosahedronGeometry(1, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const n = 0.72 + hash2(Math.round(x * 31 + y * 7), Math.round(z * 17)) * 0.55
      p.setXYZ(i, x * n, y * n * 0.78, z * n)
    }
    g.computeVertexNormals()

    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 })
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    const base = new THREE.Color(cfg.rockColor)
    const matrices: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []
    let placed = 0
    let guard = 0
    while (placed < COUNT && guard < COUNT * 20) {
      guard++
      const x = (Math.random() - 0.5) * 300
      const z = (Math.random() - 0.5) * 300
      const d = Math.sqrt(x * x + z * z)
      if (d < FLAT_RADIUS + 4) continue
      if (d > 150) continue
      const s = 0.25 + Math.pow(Math.random(), 2.2) * 2.6
      dummy.position.set(x, heightAt(x, z) - s * 0.25, z)
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI)
      dummy.scale.set(s * (0.8 + Math.random() * 0.5), s * (0.55 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.5))
      dummy.updateMatrix()
      matrices.push(dummy.matrix.clone())
      col.copy(base).offsetHSL(0, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.09)
      colors.push(col.clone())
      placed++
    }
    return { geo: g, mat: m, matrixArr: matrices, colorArr: colors }
  }, [planet])

  return (
    <instancedMesh
      args={[geo, mat, matrixArr.length]}
      castShadow
      receiveShadow
      ref={(mesh) => {
        if (mesh) {
          matrixArr.forEach((m, i) => mesh.setMatrixAt(i, m))
          colorArr.forEach((c, i) => mesh.setColorAt(i, c))
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
      }}
    />
  )
}
