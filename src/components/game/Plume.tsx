// Hyper-realistic rocket-engine fire plume (procedural shader — no textures).
// Layered: white-hot core + turbulent orange sheath + nozzle glow disc.
// Built at unit size (r=1, len=1 pointing DOWN from y=0) — the parent scales it.
'use client'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const NOISE_GLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm4(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(11.7, 5.3, 7.1);
      a *= 0.5;
    }
    return s;
  }
`

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWobble;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  ${NOISE_GLSL}
  void main() {
    vUv = uv;
    vec3 p = position;
    float ang = atan(p.x, p.z);
    // turbulent radial wobble — grows toward the trailing tip
    float w = fbm4(vec3(cos(ang) * 2.2, uv.y * 3.0 - uTime * 5.5, sin(ang) * 2.2 + uTime * 1.3));
    p.xz *= 1.0 + (w - 0.5) * 0.55 * uWobble * (0.25 + uv.y);
    // stretch flicker
    p.y *= 1.0 + (fbm4(vec3(uTime * 3.1, ang * 2.0, 4.2)) - 0.5) * 0.14 * uWobble;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  ${NOISE_GLSL}
  void main() {
    vec3 V = normalize(vViewW);
    // silhouette-soft mask: bright facing camera, transparent at edges
    float body = pow(max(dot(normalize(vNormalW), V), 0.0), 1.15);
    // downward-scrolling turbulence (exhaust accelerates away)
    float n = fbm4(vec3(vUv.x * 5.0, vUv.y * 4.2 - uTime * 4.6, uTime * 0.55));
    n = 0.68 * n + 0.32 * fbm4(vec3(vUv.x * 13.0, vUv.y * 10.0 - uTime * 8.2, uTime * 1.4));
    // fade with distance down the plume
    float tip = smoothstep(1.0, 0.30, vUv.y);
    float a = body * uIntensity * (0.42 + 0.58 * n) * tip;
    // hot streaks licking outward
    a += body * smoothstep(0.62, 0.9, n) * 0.35 * uIntensity * tip;
    a = clamp(a, 0.0, 1.0);
    vec3 col = mix(uCoreColor, uEdgeColor, clamp(n * 0.85 + vUv.y * 0.62 - 0.22, 0.0, 1.0));
    // white-hot flashes inside the core
    col += vec3(1.0, 0.97, 0.86) * smoothstep(0.7, 0.95, n) * 0.65 * (1.0 - vUv.y);
    gl_FragColor = vec4(col, a);
  }
`

/** Lathe profile of a lander plume (r=1, len=1, nozzle at y=0, tip at y=-1). */
function plumeGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.30, 0.0),
    new THREE.Vector2(0.66, -0.015),
    new THREE.Vector2(0.9, -0.09),
    new THREE.Vector2(1.0, -0.28),
    new THREE.Vector2(0.9, -0.52),
    new THREE.Vector2(0.72, -0.72),
    new THREE.Vector2(0.58, -0.87),
    new THREE.Vector2(0.7, -0.96),
    new THREE.Vector2(0.95, -1.02),
  ]
  const g = new THREE.LatheGeometry(pts, 40)
  g.computeVertexNormals()
  return g
}

function makePlumeMaterial(core: string, edge: string, intensity: number, wobble: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uCoreColor: { value: new THREE.Color(core) },
      uEdgeColor: { value: new THREE.Color(edge) },
      uWobble: { value: wobble },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,244,214,0.95)')
  grad.addColorStop(0.35, 'rgba(255,178,84,0.55)')
  grad.addColorStop(1, 'rgba(255,120,30,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/**
 * Engine fire — attach under the engine bell (y=0 at the bell exit, fire
 * extends toward -Y). Parent scales it: scale.set(radius, length, radius).
 */
export default function EnginePlume() {
  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Mesh>(null)

  const geo = useMemo(() => plumeGeometry(), [])
  const sheathMat = useMemo(() => makePlumeMaterial('#fff3c8', '#ff6414', 0.85, 1.0), [])
  const coreMat = useMemo(() => makePlumeMaterial('#ffffff', '#ffb43c', 1.25, 0.45), [])
  const glowTex = useMemo(() => glowTexture(), [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    sheathMat.uniforms.uTime.value = t
    coreMat.uniforms.uTime.value = t * 1.35
    const f = 0.92 + Math.random() * 0.16
    if (group.current) {
      group.current.scale.x = f
      group.current.scale.z = f
    }
    if (core.current) {
      const fc = 0.85 + Math.random() * 0.3
      core.current.scale.set(fc, 0.9 + Math.random() * 0.18, fc)
    }
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.5 + Math.random() * 0.4
    }
  })

  return (
    <group ref={group}>
      {/* outer turbulent sheath */}
      <mesh geometry={geo} material={sheathMat} frustumCulled={false} renderOrder={12} />
      {/* white-hot inner core */}
      <mesh ref={core} geometry={geo} material={coreMat} scale={[0.52, 0.94, 0.52]} frustumCulled={false} renderOrder={13} />
      {/* nozzle glow disc */}
      <mesh ref={glow} position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={14}>
        <circleGeometry args={[0.72, 24]} />
        <meshBasicMaterial map={glowTex} transparent blending={THREE.AdditiveBlending} depthWrite={false} opacity={0.8} />
      </mesh>
    </group>
  )
}
