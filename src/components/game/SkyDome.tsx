// Sky dome: shader gradient, sun disk + glow, procedural stars, Earth (moon sky).
'use client'
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import type { Planet } from '@/game/types'
import { PLANETS } from '@/game/types'
import { sunFactor } from '@/game/simulation'

function makeEarthTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#1b4f7e'
  g.fillRect(0, 0, 256, 128)
  // oceans gradient
  const og = g.createLinearGradient(0, 0, 0, 128)
  og.addColorStop(0, '#2b6ea3')
  og.addColorStop(0.5, '#1d5c8f')
  og.addColorStop(1, '#173f63')
  g.fillStyle = og
  g.fillRect(0, 0, 256, 128)
  // continents (blobby, stylized-realistic)
  const blob = (x: number, y: number, r: number, col: string) => {
    g.fillStyle = col
    g.beginPath()
    for (let a = 0; a < Math.PI * 2; a += 0.35) {
      const rr = r * (0.6 + Math.random() * 0.55)
      const px = x + Math.cos(a) * rr
      const py = y + Math.sin(a) * rr * 0.7
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py)
    }
    g.closePath(); g.fill()
  }
  for (let i = 0; i < 9; i++) blob(Math.random() * 256, 30 + Math.random() * 68, 12 + Math.random() * 22, '#4a6b3a')
  for (let i = 0; i < 6; i++) blob(Math.random() * 256, 25 + Math.random() * 75, 8 + Math.random() * 14, '#6a744c')
  // poles
  g.fillStyle = '#cfd8dc'
  g.fillRect(0, 0, 256, 8)
  g.fillRect(0, 120, 256, 8)
  // clouds
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256
    const y = Math.random() * 128
    const r = 4 + Math.random() * 12
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.5)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  return new THREE.CanvasTexture(c)
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`

export default function SkyDome({ planet }: { planet: Planet }) {
  const cfg = PLANETS[planet]
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const ambRef = useRef<THREE.AmbientLight>(null)
  const buriedK = useRef(0)
  const { scene } = useThree()
  const earthTex = useMemo(() => (planet === 'moon' ? makeEarthTexture() : null), [planet])

  const uniforms = useMemo(() => ({
    topColor: { value: new THREE.Color(cfg.skyTop) },
    horizonColor: { value: new THREE.Color(cfg.skyHorizon) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(cfg.sunColor) },
    sunSize: { value: planet === 'moon' ? 0.9997 : 0.9985 },
    starStrength: { value: planet === 'moon' ? 1.0 : 0.25 },
    hasStars: { value: planet === 'moon' ? 1 : 0 },
    nightFactor: { value: 0 },
    time: { value: 0 },
  }), [cfg, planet])

  const frag = useMemo(() => `
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 sunDir;
    uniform vec3 sunColor;
    uniform float sunSize;
    uniform float starStrength;
    uniform float hasStars;
    varying vec3 vDir;

    float hash(vec3 p) {
      p = fract(p * 443.8975);
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.05, 1.0);
      float t = pow(clamp(h * 1.35, 0.0, 1.0), 0.55);
      vec3 col = mix(horizonColor, topColor, t);

      // sun disk + halo
      float sd = dot(d, normalize(sunDir));
      float disk = smoothstep(sunSize, sunSize + 0.0004, sd);
      float halo = pow(max(sd, 0.0), 700.0) * 0.55 + pow(max(sd, 0.0), 40.0) * 0.16;
      col += sunColor * (disk * 2.2 + halo);

      // stars (only above horizon, twinkle subtle)
      if (hasStars > 0.5 && d.y > -0.02) {
        vec3 sp = floor(d * 320.0);
        float star = hash(sp);
        float sf = smoothstep(0.9975, 1.0, star);
        float tw = 0.75 + 0.25 * hash(sp + 1.7);
        col += vec3(0.9, 0.92, 1.0) * sf * tw * starStrength * (1.0 - t * 0.4);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `, [])

  const fog = useMemo(() => new THREE.FogExp2(cfg.fogColor, cfg.fogDensity), [cfg])

  useFrame((state, dt) => {
    void dt
    const st = useGame.getState()
    // only live-update when in game screens
    if (st.screen !== 'menu') {
      const sf = sunFactor(st.planet, st.timeOfDay)
      const dayFrac = cfg.dayFrac
      const prog = THREE.MathUtils.clamp((st.timeOfDay - 0.02) / dayFrac, 0, 1)
      const azim = THREE.MathUtils.lerp(-1.75, 1.75, prog)
      const elev = Math.sin(prog * Math.PI) * 1.05 + 0.02
      const dir = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev))
      uniforms.sunDir.value.copy(dir)
      // inside the buried habitat deck the sun/hemisphere are occluded by the
      // hull — fade them out so the interior's own lighting reads correctly
      const buried = st.inside === 'ship'
      const k = Math.min(1, dt * 3)
      buriedK.current += ((buried ? 1 : 0) - buriedK.current) * k
      const bk = buriedK.current
      if (sunRef.current) {
        sunRef.current.position.set(dir.x * 120, Math.max(6, dir.y * 120), dir.z * 120)
        const sunI = cfg.sunIntensity * (0.12 + sf * 0.88) * (st.activeEvents.some((e) => e.type === 'dust_storm') ? 0.4 : 1)
        sunRef.current.intensity = sunI * (1 - bk) + 0.02 * bk
      }
      if (hemiRef.current) hemiRef.current.intensity = (cfg.ambient * (0.35 + sf * 0.65)) * (1 - bk) + 0.05 * bk
      if (ambRef.current) ambRef.current.intensity = 0.06 * (1 - bk) + 0.03 * bk
      // storm fog
      const dustStorm = st.activeEvents.some((e) => e.type === 'dust_storm')
      const targetDensity = cfg.fogDensity * (dustStorm ? 4.2 : 1)
      fog.density += (targetDensity - fog.density) * Math.min(1, dt * 0.8)
      const targetCol = dustStorm
        ? new THREE.Color(cfg.fogColor).multiplyScalar(1.15)
        : new THREE.Color(cfg.fogColor)
      fog.color.lerp(targetCol, Math.min(1, dt))
    }
    if (!scene.fog) scene.fog = fog
  })

  return (
    <group>
      <mesh scale={850} frustumCulled={false}>
        <sphereGeometry args={[1, 48, 32]} />
        <shaderMaterial
          vertexShader={SKY_VERT}
          fragmentShader={frag}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      {earthTex && (
        <mesh position={[-180, 190, -320]} scale={26}>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial map={earthTex} roughness={0.85} emissive="#22344a" emissiveIntensity={0.35} />
        </mesh>
      )}
      <directionalLight
        ref={sunRef}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-75}
        shadow-camera-right={75}
        shadow-camera-top={75}
        shadow-camera-bottom={-75}
        shadow-camera-near={10}
        shadow-camera-far={300}
        shadow-bias={-0.0004}
        color={cfg.sunColor}
        intensity={cfg.sunIntensity}
      />
      <hemisphereLight ref={hemiRef} args={[cfg.skyHorizon, cfg.groundColor, cfg.ambient]} />
      <ambientLight ref={ambRef} intensity={0.06} />
    </group>
  )
}
