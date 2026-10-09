// Deterministic 2D value/simplex-style noise + fbm (no deps)
// Used by both the terrain mesh and the physics height function.

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

// 12-entry gradient table
const GRAD: [number, number][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]

const perm = new Uint8Array(512)
{
  // Deterministic shuffle with a fixed seed
  let s = 1337
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = p[i]
    p[i] = p[j]
    p[j] = tmp
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
}

function dot2(gi: number, x: number, y: number): number {
  const g = GRAD[gi % 12]
  return g[0] * x + g[1] * y
}

/** 2D simplex noise, range roughly [-1, 1] */
export function noise2(xin: number, yin: number): number {
  const s = (xin + yin) * F2
  const i = Math.floor(xin + s)
  const j = Math.floor(yin + s)
  const t = (i + j) * G2
  const X0 = i - t
  const Y0 = j - t
  const x0 = xin - X0
  const y0 = yin - Y0
  const i1 = x0 > y0 ? 1 : 0
  const j1 = x0 > y0 ? 0 : 1
  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2
  const y2 = y0 - 1 + 2 * G2
  const ii = i & 255
  const jj = j & 255
  let n0 = 0, n1 = 0, n2 = 0
  let t0 = 0.5 - x0 * x0 - y0 * y0
  if (t0 > 0) {
    t0 *= t0
    n0 = t0 * t0 * dot2(perm[ii + perm[jj]], x0, y0)
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1
  if (t1 > 0) {
    t1 *= t1
    n1 = t1 * t1 * dot2(perm[ii + i1 + perm[jj + j1]], x1, y1)
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2
  if (t2 > 0) {
    t2 *= t2
    n2 = t2 * t2 * dot2(perm[ii + 1 + perm[jj + 1]], x2, y2)
  }
  return 70 * (n0 + n1 + n2)
}

/** Fractal brownian motion */
export function fbm(x: number, y: number, octaves = 4, lac = 2.02, gain = 0.5): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lac
  }
  return sum / norm
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
