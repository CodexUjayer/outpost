// Convert NASA Curiosity Rover3.obj → public/models/rover/curiosity.glb
// - splits geometry into body + 6 wheels (for runtime spin/steer)
// - generates hard-edge-aware smooth normals (OBJ has none)
// - maps 297 materials → ~15 PBR color buckets (keeps draw calls low)
// - bakes scale (wheel Ø 36 units → 0.50 m, real Curiosity wheel) — front already = +Z
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/curiosity_rover_extracted/CuriosityRover/Rover3.obj'
const OUT = '/home/z/my-project/public/models/rover/curiosity.glb'
const SCALE = 0.5 / 36 // meters per unit

// ---------- parse ----------
const text = readFileSync(SRC, 'utf8')
const lines = text.split('\n')
const vx: number[] = [], vy: number[] = [], vz: number[] = []
type Face = { vi: number[]; mat: string }
const faces: Face[] = []
let curMat = 'none'

for (let li = 0; li < lines.length; li++) {
  const line = lines[li]
  if (line.charCodeAt(0) === 118) { // 'v'
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      vx.push(+p[1]); vy.push(+p[2]); vz.push(+p[3])
    }
  } else if (line.startsWith('usemtl ')) {
    curMat = line.slice(7).trim()
  } else if (line.startsWith('f ')) {
    const p = line.trim().split(/\s+/)
    const vi: number[] = []
    for (let i = 1; i < p.length; i++) {
      let idx = parseInt(p[i], 10)
      if (Number.isNaN(idx)) continue
      if (idx < 0) idx = vx.length + idx + 1
      vi.push(idx - 1)
    }
    if (vi.length >= 3) faces.push({ vi, mat: curMat })
  }
}
const NV = vx.length
console.log(`verts=${NV} faces=${faces.length}`)

// ---------- transform ----------
for (let i = 0; i < NV; i++) { vx[i] *= SCALE; vy[i] *= SCALE; vz[i] *= SCALE }

// ---------- wheel classification ----------
const WHEEL_MATS = new Set(['Wheels', 'Treads', 'Wheel_Hubs', 'Wheel_Hubs_Dark', 'Wheel_Pivot', 'Wheel_Pivot_Mid'])
type WheelId = 'FL' | 'FR' | 'ML' | 'MR' | 'RL' | 'RR'
// centers filled from disc faces below (y = radius)
const wc: Record<WheelId, { x: number; z: number; n: number; sx: number; sz: number }> = {
  FL: { x: 0, z: 0, n: 0, sx: 0, sz: 0 }, FR: { x: 0, z: 0, n: 0, sx: 0, sz: 0 },
  ML: { x: 0, z: 0, n: 0, sx: 0, sz: 0 }, MR: { x: 0, z: 0, n: 0, sx: 0, sz: 0 },
  RL: { x: 0, z: 0, n: 0, sx: 0, sz: 0 }, RR: { x: 0, z: 0, n: 0, sx: 0, sz: 0 },
}
function wheelOf(mat: string, x: number, z: number): WheelId | null {
  if (!WHEEL_MATS.has(mat)) return null
  const side = x >= 0 ? 'R' : 'L'
  let row: string
  if (z > 0.45) row = 'F'
  else if (z < -0.45) row = 'R'
  else row = 'M'
  return (row + side) as WheelId
}
// first pass: disc faces (Wheels/Treads only) estimate true axle centers
const discAcc: Record<WheelId, number[]> = { FL: [], FR: [], ML: [], MR: [], RL: [], RR: [] }
for (const f of faces) {
  if (f.mat !== 'Wheels' && f.mat !== 'Treads') continue
  let cx = 0, cz = 0
  for (const i of f.vi) { cx += vx[i]; cz += vz[i] }
  cx /= f.vi.length; cz /= f.vi.length
  const id = wheelOf(f.mat, cx, cz)
  if (id) { discAcc[id].push(cx, cz) }
}
const RADIUS = 0.25 // m (Ø 0.5)
const centers: Record<WheelId, [number, number, number]> = {} as never
for (const id of Object.keys(discAcc) as WheelId[]) {
  const a = discAcc[id]
  let x = 0, z = 0, n = a.length / 2
  for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1] }
  x /= n; z /= n
  centers[id] = [x, RADIUS, z]
  console.log(`wheel ${id}: center=(${x.toFixed(3)}, ${RADIUS}, ${z.toFixed(3)}) discFaces=${n}`)
}

// ---------- material buckets ----------
type Bucket = { name: string; color: [number, number, number]; metal: number; rough: number }
// Palette matched to the model's own reference render (Pic1.jpg):
// white painted body, mid-gray chevron wheels, bright fasteners,
// silver suspension, gold foil, dark cables & lenses.
// Metals kept low-metalness + moderate rough so the dim ambient env
// doesn't turn the rover into a black silhouette.
const BUCKETS: Bucket[] = [
  { name: 'Swatch_Red', color: [0.72, 0.16, 0.11], metal: 0.05, rough: 0.55 },
  { name: 'Swatch_Yellow', color: [0.82, 0.66, 0.14], metal: 0.05, rough: 0.55 },
  { name: 'Swatch_Green', color: [0.15, 0.46, 0.22], metal: 0.05, rough: 0.55 },
  { name: 'Swatch_Blue', color: [0.14, 0.26, 0.58], metal: 0.05, rough: 0.55 },
  { name: 'Swatch_Purple', color: [0.38, 0.18, 0.46], metal: 0.05, rough: 0.55 },
  { name: 'Swatch_White', color: [0.92, 0.92, 0.9], metal: 0.05, rough: 0.55 },
  { name: 'Penny_Copper', color: [0.72, 0.45, 0.2], metal: 0.9, rough: 0.35 },
  { name: 'Copper', color: [0.72, 0.42, 0.22], metal: 0.9, rough: 0.4 },
  { name: 'GoldFoil', color: [0.82, 0.64, 0.3], metal: 0.85, rough: 0.38 },
  { name: 'Radiator_White', color: [0.9, 0.9, 0.88], metal: 0.1, rough: 0.45 },
  { name: 'Suspension_Steel', color: [0.62, 0.63, 0.65], metal: 0.75, rough: 0.42 },
  { name: 'Wheel_Rubber', color: [0.34, 0.34, 0.35], metal: 0.05, rough: 0.93 },
  { name: 'Glass_Black', color: [0.04, 0.045, 0.05], metal: 0.6, rough: 0.12 },
  { name: 'Fastener_Steel', color: [0.66, 0.67, 0.68], metal: 0.8, rough: 0.38 },
  { name: 'Cable_Gray', color: [0.3, 0.3, 0.32], metal: 0.3, rough: 0.7 },
  { name: 'Metal_Dark', color: [0.27, 0.27, 0.29], metal: 0.35, rough: 0.6 },
  { name: 'Metal_Light', color: [0.9, 0.9, 0.88], metal: 0.15, rough: 0.5 },
  { name: 'Label_Dark', color: [0.13, 0.13, 0.14], metal: 0.05, rough: 0.6 },
  { name: 'Alu_Body', color: [0.88, 0.87, 0.84], metal: 0.2, rough: 0.5 },
  { name: 'Alu_Mid', color: [0.74, 0.73, 0.7], metal: 0.3, rough: 0.5 },
]
const matBucket = new Map<string, Bucket>()
function bucketFor(m: string): Bucket {
  const hit = matBucket.get(m)
  if (hit) return hit
  const n = m
  let b: Bucket
  if (/^Sample_Color1/.test(n)) b = BUCKETS[0]
  else if (/^Sample_Color2/.test(n)) b = BUCKETS[1]
  else if (/^Sample_Color3/.test(n)) b = BUCKETS[2]
  else if (/^Sample_Color4/.test(n)) b = BUCKETS[3]
  else if (/^Sample_Color5/.test(n)) b = BUCKETS[4]
  else if (/^Sample_Color6/.test(n)) b = BUCKETS[5]
  else if (/Penny/.test(n)) b = BUCKETS[6]
  else if (/Copper/i.test(n)) b = BUCKETS[7]
  else if (/Foil|Tinfoil/i.test(n)) b = BUCKETS[8]
  else if (/^Rad/.test(n)) b = BUCKETS[9]
  else if (/Tilt_Bar|Pivot|Hub|Axil|Actuator/i.test(n)) b = BUCKETS[10]
  else if (/Wheel|Tread/i.test(n)) b = BUCKETS[11]
  else if (/Lens|Mirror|Glass|Window|Dome_Ring/i.test(n)) b = BUCKETS[12]
  else if (/Bolt|Nut|Washer|Screw|Revit/i.test(n)) b = BUCKETS[13]
  else if (/Cable|Tube|Conduit|Hose|Connecter/i.test(n)) b = BUCKETS[14]
  else if (/Dark/i.test(n)) b = BUCKETS[15]
  else if (/Light/i.test(n)) b = BUCKETS[16]
  else if (/Text|Logo|Name_Plate|Dial_(Probe|Star)/i.test(n)) b = BUCKETS[17]
  else if (/Body|Plate|Panel|Frame|Stand|Bracket|Strut|Mast|Boom|Deck|Cover|Shield|Case|Mount|Arm|Legs|Head|Dish|Probe|Drill|Scoop|Brush|Reactor|Sensor|Cam|Lab|Target|Pad|Tray|Table|Cage|Bar|Rib|Fin|Holder|Block|Top|Ring|Base|Tips|Rods|Stud|Corner|Dome|Cylinders/i.test(n)) b = BUCKETS[18]
  else b = BUCKETS[19]
  matBucket.set(m, b)
  return b
}

// ---------- normal generation (hard-edge aware) ----------
const NORMAL_THRESHOLD = Math.cos((31 * Math.PI) / 180)

type NodeAcc = {
  pos: number[]; nor: number[]; idx: number[]; vmap: Map<number, number>
  nkey: Map<string, NodeN>
  ncount: number
}
type NodeN = { i: number; nx: number; ny: number; nz: number; next: NodeN | null }
function makeAcc(): NodeAcc {
  return { pos: [], nor: [], idx: [], vmap: new Map(), nkey: new Map(), ncount: 0 }
}
const accs: Record<string, NodeAcc> = { body: makeAcc(), FL: makeAcc(), FR: makeAcc(), ML: makeAcc(), MR: makeAcc(), RL: makeAcc(), RR: makeAcc() }

function addFace(a: NodeAcc, vi: number[], mat: string, isWheel: boolean) {
  const bIdx = bucketFor(mat)
  const b = BUCKETS.indexOf(bIdx)
  // world-space face normal (scaled space)
  const [x0, y0, z0] = [vx[vi[0]], vy[vi[0]], vz[vi[0]]]
  const e1 = [vx[vi[1]] - x0, vy[vi[1]] - y0, vz[vi[1]] - z0]
  const e2 = [vx[vi[2]] - x0, vy[vi[2]] - y0, vz[vi[2]] - z0]
  let nx = e1[1] * e2[2] - e1[2] * e2[1]
  let ny = e1[2] * e2[0] - e1[0] * e2[2]
  let nz = e1[0] * e2[1] - e1[1] * e2[0]
  const nl = Math.hypot(nx, ny, nz)
  if (nl < 1e-12) { nx = 0; ny = 1; nz = 0 } else { nx /= nl; ny /= nl; nz /= nl }
  const loc: number[] = []
  for (const gi of vi) {
    let local = a.vmap.get(gi)
    if (local === undefined) {
      local = a.pos.length / 3
      a.vmap.set(gi, local)
      a.pos.push(vx[gi], vy[gi], vz[gi])
    }
    // normal dedup by position key
    const key = `${Math.round(vx[gi] * 1e5)},${Math.round(vy[gi] * 1e5)},${Math.round(vz[gi] * 1e5)}`
    let entry = a.nkey.get(key)
    let ni = -1
    if (!entry) {
      ni = a.ncount++
      a.nor.push(nx, ny, nz)
      a.nkey.set(key, { i: ni, nx, ny, nz, next: null })
    } else {
      let node: NodeN | null = entry
      let best = -1, bestDot = -2
      while (node) {
        const d = node.nx * nx + node.ny * ny + node.nz * nz
        if (d > bestDot) { bestDot = d; best = node.i }
        node = node.next
      }
      if (bestDot >= NORMAL_THRESHOLD) ni = best
      else {
        ni = a.ncount++
        a.nor.push(nx, ny, nz)
        let tail: NodeN = entry
        while (tail.next) tail = tail.next
        tail.next = { i: ni, nx, ny, nz, next: null }
      }
    }
    loc.push(local, ni)
  }
  const push = (k0: number, k1: number, k2: number) => {
    a.idx.push(loc[k0 * 2], loc[k0 * 2 + 1], loc[k1 * 2], loc[k1 * 2 + 1], loc[k2 * 2], loc[k2 * 2 + 1], b)
  }
  push(0, 1, 2)
  if (vi.length === 4) push(0, 2, 3)
}

for (const f of faces) {
  let cx = 0, cz = 0
  for (const i of f.vi) { cx += vx[i]; cz += vz[i] }
  cx /= f.vi.length; cz /= f.vi.length
  const wid = wheelOf(f.mat, cx, cz)
  if (wid) addFace(accs[wid], f.vi, f.mat, true)
  else addFace(accs.body, f.vi, f.mat, false)
}

for (const [k, a] of Object.entries(accs)) {
  console.log(`node ${k}: verts=${a.pos.length / 3} normals=${a.ncount} tris=${a.idx.length / 7}`)
}

// ---------- GLB assembly ----------
const NODE_ORDER = ['body', 'FL', 'FR', 'ML', 'MR', 'RL', 'RR'] as const
const NODE_NAMES: Record<string, string> = {
  body: 'body', FL: 'wheel_front_left', FR: 'wheel_front_right',
  ML: 'wheel_mid_left', MR: 'wheel_mid_right', RL: 'wheel_rear_left', RR: 'wheel_rear_right',
}

const chunks: Uint8Array[] = []
let binLen = 0
const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = []
function pushView(view: ArrayBufferView) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  const pad = (4 - (binLen % 4)) % 4
  if (pad) { chunks.push(new Uint8Array(pad)); binLen += pad }
  bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.byteLength })
  chunks.push(bytes)
  binLen += bytes.byteLength
  return bufferViews.length - 1
}

const accessors: unknown[] = []
const meshes: unknown[] = []
const nodes: unknown[] = []
const materials = BUCKETS.map((b) => ({
  name: b.name,
  pbrMetallicRoughness: { baseColorFactor: [...b.color, 1], metallicFactor: b.metal, roughnessFactor: b.rough },
  doubleSided: false,
}))

let minB = [Infinity, Infinity, Infinity], maxB = [-Infinity, -Infinity, -Infinity]
for (const key of NODE_ORDER) {
  const a = accs[key]
  const posView = pushView(new Float32Array(a.pos))
  const norView = pushView(new Float32Array(a.nor))
  // indices: expand interleaved [v,n, v,n, v,n, bucket] → [v0,v1,v2] uint32 per tri
  const triCount = a.idx.length / 7
  const iarr = new Uint32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    iarr[t * 3] = a.idx[t * 7]
    iarr[t * 3 + 1] = a.idx[t * 7 + 2]
    iarr[t * 3 + 2] = a.idx[t * 7 + 4]
  }
  // position min/max
  const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < a.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = a.pos[i + k]
      if (v < pmin[k]) pmin[k] = v
      if (v > pmax[k]) pmax[k] = v
      if (v < minB[k]) minB[k] = v
      if (v > maxB[k]) maxB[k] = v
    }
  }
  const posAcc = accessors.length
  accessors.push({ bufferView: posView, componentType: 5126, count: a.pos.length / 3, type: 'VEC3', min: pmin, max: pmax })
  const norAcc = accessors.length
  accessors.push({ bufferView: norView, componentType: 5126, count: a.ncount, type: 'VEC3' })
  // group tris by bucket
  const byBucket = new Map<number, number[]>()
  for (let t = 0; t < triCount; t++) {
    const b = a.idx[t * 7 + 6]
    let arr = byBucket.get(b)
    if (!arr) { arr = []; byBucket.set(b, arr) }
    arr.push(iarr[t * 3], iarr[t * 3 + 1], iarr[t * 3 + 2])
  }
  const primitives: unknown[] = []
  for (const [b, arr] of byBucket) {
    const iarrB = new Uint32Array(arr)
    const idxViewB = pushView(iarrB)
    const idxAccB = accessors.length
    accessors.push({ bufferView: idxViewB, componentType: 5125, count: iarrB.length, type: 'SCALAR' })
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: idxAccB, material: b, mode: 4 })
  }
  meshes.push({ name: NODE_NAMES[key], primitives })
  nodes.push({ name: NODE_NAMES[key], mesh: meshes.length - 1 })
}

const totalVerts = accs.body.pos.length / 3 + NODE_ORDER.slice(1).reduce((s, k) => s + accs[k].pos.length / 3, 0)
console.log(`total verts=${totalVerts} bbox=[${minB.map(v => v.toFixed(2))} .. ${maxB.map(v => v.toFixed(2))}]`)

const gltf = {
  asset: { version: '2.0', generator: 'curiosity-convert' },
  scene: 0,
  scenes: [{ name: 'CuriosityRover', nodes: NODE_ORDER.map((_, i) => i) }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLen }],
}

const jsonStr = JSON.stringify(gltf)
const jsonBytes = new TextEncoder().encode(jsonStr)
const jsonPad = (4 - (jsonBytes.length % 4)) % 4
const jsonPadBytes = jsonPad > 0 ? new Uint8Array(jsonPad).fill(0x20) : new Uint8Array(0) // GLB: JSON chunk pads with SPACES
const binPad = (4 - (binLen % 4)) % 4
const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLen + binPad
const glb = new Uint8Array(total)
const dv = new DataView(glb.buffer)
dv.setUint32(0, 0x46546C67, true) // glTF
dv.setUint32(4, 2, true)
dv.setUint32(8, total, true)
dv.setUint32(12, jsonBytes.length + jsonPad, true)
dv.setUint32(16, 0x4E4F534A, true) // JSON
glb.set(jsonBytes, 20)
glb.set(jsonPadBytes, 20 + jsonBytes.length)
let off = 20 + jsonBytes.length + jsonPad
dv.setUint32(off, binLen + binPad, true)
dv.setUint32(off + 4, 0x004E4942, true) // BIN
off += 8
for (const c of chunks) { glb.set(c, off); off += c.byteLength }

writeFileSync(OUT, glb)
console.log(`wrote ${OUT} (${(total / 1048576).toFixed(1)} MB)`)

// meta for Rover.tsx
const meta = {
  scale: SCALE,
  wheelRadius: RADIUS,
  sizeM: { x: +(maxB[0] - minB[0]).toFixed(2), y: +(maxB[1] - minB[1]).toFixed(2), z: +(maxB[2] - minB[2]).toFixed(2) },
  wheels: Object.fromEntries((Object.keys(centers) as WheelId[]).map((k) => [k, centers[k].map(v => +v.toFixed(4))])),
  wheelIds: NODE_ORDER.slice(1),
}
writeFileSync('/home/z/my-project/tools/rover_out_meta.json', JSON.stringify(meta, null, 2))
console.log(JSON.stringify(meta, null, 2))
