// Procedural terrain mesh — physics heightfield + visual micro-relief,
// skinned with the procedural moon/mars soil setup (albedo+normal+roughness).
'use client'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { heightAt, WORLD_SIZE, hash2 } from '@/game/terrain'
import { noise2, fbm } from '@/game/noise'
import { getSoilSetup, warmupSoil } from '@/game/soil'
import type { Planet } from '@/game/types'
import { PLANETS } from '@/game/types'

// 40k vertices → ~1.7 m spacing: enough for the medium craters (≥1.7 m);
// sub-meter detail comes from the soil normal map.
const SEG = 200

export default function Terrain({ planet }: { planet: Planet }) {
  const cfg = PLANETS[planet]

  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    // Albedo texture carries the planet color — vertex colors only modulate
    // brightness (mineral patches, dusty highs, slopes) to break up tiling.
    const tint = new THREE.Color(cfg.groundColor).lerp(new THREE.Color('#ffffff'), 0.88)
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      // physics height + visual-only micro relief (dust ripples & fine bumps —
      // small enough that feet never visibly float)
      const h =
        heightAt(x, z) +
        Math.sin((x * 0.9 + z * 0.55) * 2.2 + fbm(x * 0.05, z * 0.05, 2) * 3.2) * 0.013 +
        noise2(x * 0.42, z * 0.42) * 0.022
      pos.setY(i, h)
      const patch = noise2(x * 0.016, z * 0.016)
      const patch2 = fbm(x * 0.07 + 31, z * 0.07 - 12, 2)
      const hn = heightAt(x + 1.4, z) - h
      const slope = Math.min(1, Math.abs(hn) * 0.7)
      const v = hash2(Math.round(x * 2), Math.round(z * 2)) * 0.05
      const shade = THREE.MathUtils.clamp(
        0.9 + patch * 0.1 + patch2 * 0.09 - slope * 0.22 + v,
        0.68,
        1.06,
      )
      tmp.copy(tint).multiplyScalar(shade)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [cfg])

  const mat = useMemo(() => {
    const soil = getSoilSetup(planet)
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: soil.map,
      normalMap: soil.normalMap,
      roughnessMap: soil.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.55,
    })
  }, [planet])

  // pre-generate the other planet's soil during idle time
  useEffect(() => {
    const t = setTimeout(() => warmupSoil(), 4000)
    return () => clearTimeout(t)
  }, [])

  return <mesh geometry={geo} material={mat} receiveShadow position={[0, 0, 0]} />
}
