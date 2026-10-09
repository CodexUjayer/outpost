// Analyze the NASA Curiosity Rover OBJ: bbox, key-material centroids, wheel clusters
import { readFileSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/curiosity_rover_extracted/CuriosityRover/Rover3.obj'

const text = readFileSync(SRC, 'utf8')
const lines = text.split('\n')
const verts: number[][] = []
const matFaces = new Map<string, number[]>() // mat -> [centroid x,y,z, ...] flattened per face
const matFaceCount = new Map<string, number>()
let curMat = 'none'
let hasVt = 0, hasVn = 0

let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]

for (const line of lines) {
  if (line.startsWith('v ')) {
    const p = line.trim().split(/\s+/)
    const x = +p[1], y = +p[2], z = +p[3]
    verts.push([x, y, z])
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z
  } else if (line.startsWith('vt ')) hasVt++
  else if (line.startsWith('vn ')) hasVn++
  else if (line.startsWith('usemtl ')) curMat = line.slice(7).trim()
  else if (line.startsWith('f ')) {
    const p = line.trim().split(/\s+/)
    let cx = 0, cy = 0, cz = 0, n = 0
    for (let i = 1; i < p.length; i++) {
      const idx = parseInt(p[i].split('/')[0], 10)
      if (!idx || !verts[idx - 1]) continue
      const v = verts[idx - 1]
      cx += v[0]; cy += v[1]; cz += v[2]; n++
    }
    if (n === 0) continue
    cx /= n; cy /= n; cz /= n
    if (!matFaces.has(curMat)) matFaces.set(curMat, [])
    matFaces.get(curMat)!.push(cx, cy, cz)
    matFaceCount.set(curMat, (matFaceCount.get(curMat) ?? 0) + 1)
  }
}

function centroid(mat: string): [number, number, number] | null {
  const arr = matFaces.get(mat)
  if (!arr) return null
  let x = 0, y = 0, z = 0, n = 0
  for (let i = 0; i < arr.length; i += 3) { x += arr[i]; y += arr[i + 1]; z += arr[i + 2]; n++ }
  return [x / n, y / n, z / n]
}

console.log('bbox min', min.map(v => v.toFixed(1)), 'max', max.map(v => v.toFixed(1)))
console.log('vt lines:', hasVt, 'vn lines:', hasVn, 'materials:', matFaces.size)
for (const m of ['Mast_Cameras', 'Head', 'Chem_Cam_Motor_', 'Body', 'Front_Plate', 'Wheels', 'Treads', 'Wheel_Hubs', 'Wheel_Pivot', 'Legs', 'Sun_Dial_Base', 'Flat_Dish']) {
  const c = centroid(m)
  console.log(`centroid ${m}:`, c ? c.map(v => v.toFixed(1)).join(', ') : 'N/A', `faces=${matFaceCount.get(m) ?? 0}`)
}

// cluster wheel-ish materials spatially
const WHEEL_MATS = new Set(['Wheels', 'Treads', 'Wheel_Hubs', 'Wheel_Hubs_Dark', 'Wheel_Pivot', 'Wheel_Pivot_Mid'])
type Cl = { cx: number; cy: number; cz: number; n: number; minx: number; maxx: number; miny: number; maxy: number; minz: number; maxz: number; mats: Map<string, number> }
const clusters: Cl[] = []
for (const [m, arr] of matFaces) {
  if (!WHEEL_MATS.has(m)) continue
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2]
    let best: Cl | null = null, bestD = Infinity
    for (const c of clusters) {
      const d = (c.cx - x) ** 2 + (c.cz - z) ** 2
      if (d < bestD) { bestD = d; best = c }
    }
    if (best && bestD < 14 * 14) {
      const n1 = best.n + 1
      best.cx += (x - best.cx) / n1; best.cz += (z - best.cz) / n1; best.cy += (y - best.cy) / n1
      best.minx = Math.min(best.minx, x); best.maxx = Math.max(best.maxx, x)
      best.miny = Math.min(best.miny, y); best.maxy = Math.max(best.maxy, y)
      best.minz = Math.min(best.minz, z); best.maxz = Math.max(best.maxz, z)
      best.n = n1
      best.mats.set(m, (best.mats.get(m) ?? 0) + 1)
    } else {
      clusters.push({ cx: x, cy: y, cz: z, n: 1, minx: x, maxx: x, miny: y, maxy: y, minz: z, maxz: z, mats: new Map([[m, 1]]) })
    }
  }
}
const big = clusters.filter(c => c.n > 400).sort((a, b) => b.n - a.n)
console.log('\nwheel clusters (n>400):', big.length)
for (const c of big) {
  console.log(`  center=(${c.cx.toFixed(1)}, ${c.cy.toFixed(1)}, ${c.cz.toFixed(1)}) n=${c.n} x[${c.minx.toFixed(0)},${c.maxx.toFixed(0)}] y[${c.miny.toFixed(0)},${c.maxy.toFixed(0)}] z[${c.minz.toFixed(0)},${c.maxz.toFixed(0)}] diamY=${(c.maxy - c.miny).toFixed(1)} mats=${[...c.mats].map(([k, v]) => k + ':' + v).join(',')}`)
}
