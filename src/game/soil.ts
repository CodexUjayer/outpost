// ================================================================
// Procedural Moon & Mars soil setups — hyper-realistic regolith
// ================================================================
// Generates a full PBR material input set (albedo + normal + roughness) on
// canvas, entirely from seeded noise — no image assets. Every texture is
// seamlessly tileable (noise lattice wraps; feature stamps write with wrap).
//
// Moon setup: desaturated regolith, dark basaltic maria patches, fresh
//   micro-craters with bright ejecta halos, sparse sharp pebbles, faint rays.
// Mars setup: rust-red dust, aeolian streaks, eroded craters, dust ripples,
//   denser pebble field, soft dust veils.
import * as THREE from 'three'
import { lerp, clamp, smoothstep } from './noise'
import { hash2 } from './terrain'

export type SoilPlanet = 'moon' | 'mars'

export interface SoilSetup {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
}

// one tile spans WORLD_SIZE / SOIL_REPEAT ≈ 7 m of ground
export const SOIL_REPEAT = 32
const S = 1024 // texture resolution

const cache: Partial<Record<SoilPlanet, SoilSetup>> = {}

export function getSoilSetup(planet: SoilPlanet): SoilSetup {
  const hit = cache[planet]
  if (hit) return hit
  const setup = planet === 'mars' ? buildMars() : buildMoon()
  cache[planet] = setup
  return setup
}

/** Pre-generate both planets (call from idle time to hide the hitch). */
export function warmupSoil(): void {
  getSoilSetup('moon')
  getSoilSetup('mars')
}

// ----------------------------------------------------------------
// Periodic (seamless) value noise — lattice indices wrap mod `per`
// ----------------------------------------------------------------
function pnoise(x: number, y: number, per: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
  const w = (ix: number, iy: number) => {
    const px = ((ix % per) + per) % per
    const py = ((iy % per) + per) % per
    return hash2(px + seed * 1013, py + seed * 7211)
  }
  const a = w(xi, yi)
  const b = w(xi + 1, yi)
  const c = w(xi, yi + 1)
  const d = w(xi + 1, yi + 1)
  return (lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1)
}

function pfbm(x: number, y: number, oct: number, per: number, seed: number): number {
  let amp = 1
  let f = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < oct; o++) {
    sum += amp * pnoise(x * f, y * f, per * f, seed + o * 17)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

// wrap-safe pixel write
interface Field {
  h: Float32Array // height
  ej: Float32Array // ejecta (+bright) / bowl (−dark) albedo modifier
}

function stamp(field: Field, cx: number, cy: number, r: number, fn: (t: number, dx: number, dy: number) => [number, number]) {
  const R = Math.ceil(r)
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) continue
      const [dh, de] = fn(d / r, dx / r, dy / r)
      const px = (((cx + dx) % S) + S) % S
      const py = (((cy + dy) % S) + S) % S
      const i = py * S + px
      field.h[i] += dh
      field.ej[i] += de
    }
  }
}

// ----------------------------------------------------------------
// Shared generator — palettes & feature density differ per planet
// ----------------------------------------------------------------
interface SoilStyle {
  cDark: [number, number, number]
  cMid: [number, number, number]
  cLight: [number, number, number]
  mareAmt: number // dark-patch strength
  dustAmt: number // bright dust veil strength
  craterCount: number
  craterDepth: [number, number]
  craterRim: number // rim prominence (older craters erode)
  ejecta: number
  pebbleDensity: number
  pebbleR: [number, number]
  rippleAmp: number
  rippleLen: number
  rayCraters: number // bright ray systems (fresh craters)
  darkStreaks: number // aeolian streaks
  normalK: number
}

function buildSoil(style: SoilStyle): SoilSetup {
  // ---------- height + ejecta fields ----------
  const field: Field = { h: new Float32Array(S * S), ej: new Float32Array(S * S) }
  const { h, ej } = field

  // base undulation (periodic)
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      h[i] =
        pfbm(u * 5, v * 5, 4, 5, 11) * 0.55 +
        pfbm(u * 17, v * 17, 3, 17, 29) * 0.22 +
        (hash2(x * 7 + 1, y * 13 + 5) - 0.5) * 0.05
    }
  }

  // ripples (dust waves, warped so they meander; patchy — only where dust collects)
  {
    const ca = Math.cos(0.55)
    const sa = Math.sin(0.55)
    for (let y = 0; y < S; y++) {
      const v = y / S
      for (let x = 0; x < S; x++) {
        const u = x / S
        const px = x * ca - y * sa
        const warp = pfbm(u * 3, v * 3, 2, 3, 71) * 9
        const mask = smoothstep(-0.05, 0.5, pfbm(u * 3.4 + 7.7, v * 3.4 + 3.1, 2, 4, 83))
        h[y * S + x] += Math.sin(((px + warp) / style.rippleLen) * Math.PI * 2) * style.rippleAmp * mask
      }
    }
  }

  // pebbles — hash-scattered angular stones (bump the height field)
  {
    const cell = 9
    const n = Math.floor(S / cell)
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        if (hash2(cx * 31 + 7, cy * 57 + 3) > style.pebbleDensity) continue
        const px = (cx + hash2(cx * 11, cy * 3 + 1)) * cell
        const py = (cy + hash2(cx * 5, cy * 13 + 9)) * cell
        const r = lerp(style.pebbleR[0], style.pebbleR[1], hash2(cx * 7, cy * 17) ** 1.6)
        const amp = 0.5 + hash2(cx * 19, cy * 23) * 1.1
        stamp(field, px, py, r, (t) => {
          const bump = (1 - t * t) * (1 - t * t) * amp
          return [bump, 0]
        })
      }
    }
  }

  // micro-craters — bowl + raised rim + ejecta halo
  for (let k = 0; k < style.craterCount; k++) {
    const px = hash2(k * 97 + 13, 401) * S
    const py = hash2(k * 41 + 71, 823) * S
    const r = lerp(4, 22, hash2(k * 13 + 5, 97) ** 1.9)
    const depth = lerp(style.craterDepth[0], style.craterDepth[1], 1 - r / 22) * (0.7 + hash2(k, 61) * 0.6)
    stamp(field, px, py, r * 1.8, (t) => {
      if (t < 0.56) {
        // bowl
        const b = 1 - (t / 0.56) ** 2
        return [-depth * b * b, -0.1 * b]
      }
      if (t < 0.82) {
        // rim
        const rim = Math.sin(((t - 0.56) / 0.26) * Math.PI)
        return [depth * style.craterRim * rim, 0.08 * rim]
      }
      // ejecta halo
      const halo = 1 - smoothstep(0.82, 1, t)
      return [depth * 0.06 * halo, style.ejecta * halo]
    })
  }

  // ---------- albedo + roughness ----------
  const albedo = new Uint8ClampedArray(S * S * 4)
  const rough = new Uint8ClampedArray(S * S * 4)
  const [dr, dg, db] = style.cDark
  const [mr, mg, mb] = style.cMid
  const [lr, lg, lb] = style.cLight
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      // patchwork: dark mare-like regions, bright dusty highs
      const mare = smoothstep(0.14, 0.6, pfbm(u * 3 + 0.31, v * 3 + 0.77, 3, 3, 91)) * style.mareAmt
      const dust = smoothstep(0.1, 0.75, pfbm(u * 4 + 1.9, v * 4 + 0.4, 2, 4, 51)) * style.dustAmt
      let r = lerp(lerp(mr, dr, mare), lr, dust)
      let g = lerp(lerp(mg, dg, mare), lg, dust)
      let b = lerp(lerp(mb, db, mare), lb, dust)
      // crater ejecta brightening / bowl darkening
      const e = ej[i]
      r += e * (lr - mr)
      g += e * (lg - mg)
      b += e * (lb - mb)
      // grain speckle, clumped by a mid-scale dust mask so it reads as soil,
      // not uniform static
      const clump = 0.55 + 0.9 * smoothstep(-0.35, 0.55, pfbm(u * 9 + 4.2, v * 9 + 8.8, 2, 9, 123))
      const sp = (hash2(x * 3 + 9, y * 7 + 2) - 0.5) * 0.075 * clump
      r *= 1 + sp
      g *= 1 + sp
      b *= 1 + sp
      const gseed = hash2(x * 17 + 3, y * 11 + 8)
      if (gseed > 0.993) {
        r *= 0.74; g *= 0.74; b *= 0.74 // dark grains
      } else if (gseed < 0.007) {
        r *= 1.16; g *= 1.16; b *= 1.16 // bright grains
      }
      const o = i * 4
      albedo[o] = r * 255
      albedo[o + 1] = g * 255
      albedo[o + 2] = b * 255
      albedo[o + 3] = 255
      // roughness: dust films are smoother, basalt patches rougher
      const ro = clamp(0.96 + mare * 0.03 - dust * 0.07 + sp * 0.3, 0.78, 1)
      rough[o] = ro * 255
      rough[o + 1] = ro * 255
      rough[o + 2] = ro * 255
      rough[o + 3] = 255
    }
  }

  // ---------- normal map (Sobel on the final height field) ----------
  const normal = new Uint8ClampedArray(S * S * 4)
  const K = style.normalK
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S
    const yp = ((y + 1) % S) * S
    const yc = y * S
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S
      const xp = (x + 1) % S
      const dhdx = (h[yc + xp] - h[yc + xm]) * K
      const dhdy = (h[yp + x] - h[ym + x]) * K
      // tangent-space: n = normalize(-dh/dx, +dh/dy, 1)  (canvas flipY-safe)
      const inv = 1 / Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1)
      const o = (yc + x) * 4
      normal[o] = (-dhdx * inv * 0.5 + 0.5) * 255
      normal[o + 1] = (dhdy * inv * 0.5 + 0.5) * 255
      normal[o + 2] = (inv * 0.5 + 0.5) * 255
      normal[o + 3] = 255
    }
  }

  // ---------- canvases + surface streaks ----------
  const mk = (data: Uint8ClampedArray): HTMLCanvasElement => {
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length), S, S), 0, 0)
    return c
  }
  const albedoCanvas = mk(albedo)
  drawStreaks(albedoCanvas, style)

  const map = new THREE.CanvasTexture(albedoCanvas)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(SOIL_REPEAT, SOIL_REPEAT)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8

  const normalMap = new THREE.CanvasTexture(mk(normal))
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  normalMap.repeat.set(SOIL_REPEAT, SOIL_REPEAT)
  normalMap.anisotropy = 8

  const roughnessMap = new THREE.CanvasTexture(mk(rough))
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  roughnessMap.repeat.set(SOIL_REPEAT, SOIL_REPEAT)

  return { map, normalMap, roughnessMap }
}

/** Bright ray systems (fresh impacts) / dark aeolian streaks over the albedo. */
function drawStreaks(canvas: HTMLCanvasElement, style: SoilStyle) {
  const ctx = canvas.getContext('2d')!
  // ray systems
  for (let k = 0; k < style.rayCraters; k++) {
    const cx = hash2(k * 71 + 3, 977) * S
    const cy = hash2(k * 37 + 11, 613) * S
    const rays = 7 + Math.floor(hash2(k, 151) * 6)
    for (let rI = 0; rI < rays; rI++) {
      const ang = (rI / rays) * Math.PI * 2 + hash2(k * 9, rI) * 0.7
      const len = 60 + hash2(k * 5, rI * 3) * 150
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(ang)
      const grad = ctx.createLinearGradient(0, 0, len, 0)
      grad.addColorStop(0, 'rgba(255,250,240,0.16)')
      grad.addColorStop(0.4, 'rgba(255,250,240,0.07)')
      grad.addColorStop(1, 'rgba(255,250,240,0)')
      ctx.strokeStyle = grad
      ctx.lineWidth = 3 + hash2(k * 3, rI) * 7
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(len, (hash2(k, rI * 7) - 0.5) * 30)
      ctx.stroke()
      ctx.restore()
    }
  }
  // dark wind streaks
  for (let k = 0; k < style.darkStreaks; k++) {
    const cx = hash2(k * 53 + 29, 389) * S
    const cy = hash2(k * 23 + 41, 449) * S
    const len = 120 + hash2(k, 71) * 260
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(0.5 + hash2(k * 7, 3) * 0.5)
    const grad = ctx.createLinearGradient(0, 0, len, 0)
    grad.addColorStop(0, 'rgba(30,14,6,0.13)')
    grad.addColorStop(1, 'rgba(30,14,6,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 14 + hash2(k * 11, 5) * 30
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(len, (hash2(k * 2, r2(k)) - 0.5) * 50)
    ctx.stroke()
    ctx.restore()
  }
}
function r2(k: number): number {
  return hash2(k * 13 + 1, 37) * 100
}

// ----------------------------------------------------------------
// Planet styles
// ----------------------------------------------------------------
function buildMoon(): SoilSetup {
  return buildSoil({
    cDark: [0.3, 0.29, 0.275], // basaltic maria
    cMid: [0.585, 0.57, 0.54], // regolith
    cLight: [0.78, 0.765, 0.73], // dusty highlands / ejecta
    mareAmt: 0.8,
    dustAmt: 0.45,
    craterCount: 64,
    craterDepth: [0.6, 1.7],
    craterRim: 0.55,
    ejecta: 0.3,
    pebbleDensity: 0.42,
    pebbleR: [1.6, 4.6],
    rippleAmp: 0.013,
    rippleLen: 46,
    rayCraters: 3,
    darkStreaks: 0,
    normalK: 38,
  })
}

function buildMars(): SoilSetup {
  return buildSoil({
    cDark: [0.38, 0.2, 0.11], // weathered basalt
    cMid: [0.68, 0.39, 0.21], // classic rust dust
    cLight: [0.84, 0.6, 0.38], // bright dust film
    mareAmt: 0.55,
    dustAmt: 0.7,
    craterCount: 48,
    craterDepth: [0.45, 1.3],
    craterRim: 0.38, // eroded rims
    ejecta: 0.18,
    pebbleDensity: 0.55,
    pebbleR: [1.6, 5.2],
    rippleAmp: 0.045,
    rippleLen: 40,
    rayCraters: 0,
    darkStreaks: 6,
    normalK: 36,
  })
}
