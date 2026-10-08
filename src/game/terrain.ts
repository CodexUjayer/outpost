// Shared terrain math — used by the 3D mesh AND physics/collision.
import { fbm, smoothstep, lerp } from './noise'

export const WORLD_SIZE = 340
export const COLONY_RADIUS = 62 // max build distance from lander
export const FLAT_RADIUS = 14 // fully-flatten inside this radius (landing site)
export const BLEND_RADIUS = 46 // blend to full noise by this radius

interface Crater {
  x: number
  z: number
  r: number
  d: number
}

const CRATERS: Crater[] = [
  { x: 74, z: -52, r: 26, d: 4.4 },
  { x: -92, z: 38, r: 34, d: 5.6 },
  { x: 46, z: 88, r: 18, d: 2.8 },
  { x: -58, z: -96, r: 22, d: 3.4 },
  { x: 128, z: 24, r: 40, d: 6.2 },
  { x: -128, z: -30, r: 30, d: 4.8 },
  { x: 24, z: -128, r: 16, d: 2.4 },
  { x: -30, z: 132, r: 28, d: 4.0 },
]

// medium fresh craters scattered around the map (deterministic)
const SMALL_CRATERS: Crater[] = []
{
  let n = 0
  let guard = 0
  while (n < 34 && guard < 600) {
    guard++
    const x = (hash2(n * 91 + 7, 17) - 0.5) * 300
    const z = (hash2(n * 57 + 3, 293) - 0.5) * 300
    if (Math.sqrt(x * x + z * z) < 20) continue // keep the landing site clear
    const r = 1.7 + hash2(n, 5) * 4.6 // 1.7 – 6.3 m
    const d = r * (0.1 + hash2(n, 9) * 0.08)
    SMALL_CRATERS.push({ x, z, r, d })
    n++
  }
}

function rawHeight(x: number, z: number): number {
  let h = 0
  h += fbm(x * 0.0065, z * 0.0065, 4) * 10.5 // rolling hills
  h += fbm(x * 0.028 + 40, z * 0.028 - 17, 3) * 1.8 // medium bumps
  h += fbm(x * 0.11 - 9, z * 0.11 + 5, 2) * 0.32 // small detail
  h += fbm(x * 0.33 + 71, z * 0.33 - 41, 2) * 0.09 // fine regolith undulation
  // ridges
  const ridge = 1 - Math.abs(fbm(x * 0.004 + 100, z * 0.004, 2))
  h += ridge * ridge * 6
  // craters: bowl + rim + ejecta apron
  for (const c of CRATERS) {
    const dx = x - c.x
    const dz = z - c.z
    const dd = dx * dx + dz * dz
    const reach = c.r * 1.75
    if (dd < reach * reach) {
      const d = Math.sqrt(dd)
      const t = d / c.r
      if (t < 1) {
        // concave bowl
        const bowl = (1 - t * t) * (1 - t * t)
        h -= c.d * bowl
        // raised rim crowning the edge
        const rim = smoothstep(0.55, 0.95, t)
        h += c.d * 0.5 * rim
      } else {
        // rim falls off, then a gentle ejecta apron
        const apron = 1 - smoothstep(1.0, 1.75, t)
        h += c.d * 0.5 * apron + c.d * 0.16 * apron * apron
      }
    }
  }
  // medium fresh craters
  for (const c of SMALL_CRATERS) {
    const dx = x - c.x
    const dz = z - c.z
    const dd = dx * dx + dz * dz
    if (dd < c.r * 1.6 * (c.r * 1.6)) {
      const t = Math.sqrt(dd) / c.r
      if (t < 1) {
        const bowl = (1 - t * t) * (1 - t * t)
        h -= c.d * bowl
        h += c.d * 0.45 * smoothstep(0.5, 0.95, t)
      } else {
        const apron = 1 - smoothstep(1.0, 1.6, t)
        h += c.d * 0.45 * apron
      }
    }
  }
  // tiny hash-scattered dips (sub-meter pockmarks everywhere)
  {
    const cell = 7
    const gx = Math.floor(x / cell)
    const gz = Math.floor(z / cell)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const cx = gx + ox
        const cz = gz + oz
        const s = hash2(cx * 137 + 61, cz * 191 + 29)
        if (s > 0.34) continue
        const px = (cx + hash2(cx, cz * 3)) * cell
        const pz = (cz + hash2(cx * 5, cz)) * cell
        const r = 0.55 + hash2(cx * 7, cz * 11) * 1.15
        const dx = x - px
        const dz = z - pz
        const d = Math.sqrt(dx * dx + dz * dz)
        const depth = 0.07 + s * 0.55
        if (d < r) {
          const t = d / r
          h -= depth * (1 - t * t) * (1 - t * t)
        } else if (d < r * 1.45) {
          // tiny raised rim
          h += depth * 0.3 * (1 - smoothstep(1.0, 1.45, d / r))
        }
      }
    }
  }
  return h
}

const H0 = rawHeight(0, 0)

/** Ground height at world position. */
export function heightAt(x: number, z: number): number {
  const d = Math.sqrt(x * x + z * z)
  const f = smoothstep(FLAT_RADIUS, BLEND_RADIUS, d)
  return lerp(H0 + 0.0, rawHeight(x, z), f)
}

/** Approximate slope (0 = flat, 1 = 45deg) — used for placement validation. */
export function slopeAt(x: number, z: number): number {
  const e = 1.2
  const hx = heightAt(x + e, z) - heightAt(x - e, z)
  const hz = heightAt(x, z + e) - heightAt(x, z - e)
  return Math.sqrt(hx * hx + hz * hz) / (2 * e)
}

/** Deterministic pseudo random from integers */
export function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}
