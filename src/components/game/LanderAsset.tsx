// The uploaded "realistic-lander" GLB (converted from the user's OBJ) with a
// two-zone PBR skin: gold Kapton foil on the descent stage, brushed metal
// cabin above, soot darkening toward the engine bell. Suspense fallback is a
// procedural stand-in so the world is never empty while the GLB streams in.
'use client'
import { Suspense, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { LANDER_MODEL_URL, LANDER_SCALE } from '@/game/lander'
import { getMats } from './materials'

// warm up the fetch as soon as this module is imported in the browser
if (typeof window !== 'undefined') {
  useLoader.preload(GLTFLoader, LANDER_MODEL_URL)
}

/**
 * One mesh, one material — zones are painted in the shader by local height:
 *   y < 3.04 (descent stage) → gold foil   |   y > 3.04 (cabin) → light alloy
 * soot near the bell, brushed-metal streaks, panel-band dithering.
 */
function makeLanderMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0.55,
    roughness: 0.5,
    envMapIntensity: 1.0,
  })
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLpos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLpos = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vLpos;
        float lhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float lnoise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lhash(i), lhash(i + vec2(1,0)), f.x),
                     mix(lhash(i + vec2(0,1)), lhash(i + vec2(1,1)), f.x), f.y);
        }
        float vGoldG = 0.0;
        float vSootG = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float y = vLpos.y;
          float dith = lnoise(vec2(atan(vLpos.z, vLpos.x) * 14.0, y * 6.0));
          // gold-foil descent stage (below y≈3.04) with a dithered panel boundary
          float gold = (1.0 - smoothstep(2.82, 3.12, y)) + (dith - 0.5) * 0.22;
          gold = clamp(gold, 0.0, 1.0);
          // engine soot + dust staining near the bell and on the legs
          float soot = smoothstep(1.7, 0.1, y) * (0.45 + 0.35 * dith);
          soot = max(soot, smoothstep(1.35, 0.2, length(vLpos.xz)) * 0.25 * smoothstep(3.2, 2.4, y));
          vec3 goldCol = vec3(0.72, 0.53, 0.20);
          vec3 grayCol = vec3(0.82, 0.84, 0.87);
          vec3 base = mix(grayCol, goldCol, gold);
          base *= 1.0 - soot * 0.72;
          base *= 0.9 + 0.2 * lnoise(vec2(atan(vLpos.z, vLpos.x) * 64.0, y * 30.0));
          base *= 0.94 + 0.12 * lnoise(vec2(vLpos.x * 9.0, vLpos.z * 9.0));
          diffuseColor.rgb *= base;
          vGoldG = gold;
          vSootG = clamp(soot, 0.0, 1.0);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.52, 0.34, vGoldG);
        roughnessFactor = clamp(roughnessFactor + vSootG * 0.35 + (lnoise(vec2(vLpos.y * 22.0, atan(vLpos.z, vLpos.x) * 40.0)) - 0.5) * 0.18, 0.08, 1.0);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.5, 0.9, vGoldG);
        metalnessFactor = clamp(metalnessFactor - vSootG * 0.3, 0.0, 1.0);`,
      )
  }
  return mat
}

function LanderMesh() {
  const gltf = useLoader(GLTFLoader, LANDER_MODEL_URL)
  const model = useMemo(() => {
    const src = gltf.scene
    const mat = makeLanderMaterial()
    src.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.material = mat
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false // single huge mesh — never cull mid-frame
    })
    return src
  }, [gltf])
  return <primitive object={model} />
}

/** Low-poly stand-in shown while the 18 MB GLB loads (matches silhouette). */
function LanderFallback() {
  const m = getMats()
  return (
    <group>
      <mesh position={[0, 3.7, 0]} castShadow>
        <cylinderGeometry args={[4.4, 4.7, 5.9, 10]} />
        <primitive object={m.goldFoil} attach="material" />
      </mesh>
      <mesh position={[0, 8.6, 0]} castShadow>
        <cylinderGeometry args={[3.1, 3.4, 5.3, 10]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      <mesh position={[0, 10.6, 0]}>
        <sphereGeometry args={[2.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <primitive object={m.hullWhite} attach="material" />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        return (
          <mesh key={i} position={[Math.cos(a) * 5.4, 2.4, Math.sin(a) * 5.4]} rotation={[0.55, -a + Math.PI / 2, 0]} castShadow>
            <cylinderGeometry args={[0.14, 0.18, 5.2, 6]} />
            <primitive object={m.hullGray} attach="material" />
          </mesh>
        )
      })}
    </group>
  )
}

export default function LanderAsset({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = LANDER_SCALE,
}: {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
}) {
  return (
    <group position={position} rotation={rotation} scale={[scale, scale, scale]}>
      <Suspense fallback={<LanderFallback />}>
        <LanderMesh />
      </Suspense>
    </group>
  )
}
