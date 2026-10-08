// Custom OBJ → GLB converter for the lander (index-deduped, ~3x smaller than
// the OBJLoader+GLTFExporter path, no browser APIs needed).
// - strips stray `l` polyline commands (they flip OBJLoader to LineSegments)
// - centers X/Z, ground (min Y) at y=0
// - dedupes (v,vt,vn) corners into an indexed mesh
// - prints a radial slice histogram for tuning cabin/hatch constants
// Run: bun scripts/convert-lander.ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const SRC = '/home/z/my-project/upload/realistic-lander+AA.obj'
const OUT = '/home/z/my-project/public/models/lander.glb'

console.log('parsing OBJ…')
const text = readFileSync(SRC, 'utf8')
const lines = text.split('\n')

// ---- first pass: raw v/vt/vn + face corners ----
const rv: number[] = [] // raw vertices  (x,y,z)*
const rvt: number[] = [] // raw uvs      (u,v)*
const rvn: number[] = [] // raw normals  (x,y,z)*
let faceCorners = new Int32Array(4 * 1024 * 1024) // (vi,ti,ni)* per corner, fan-triangulated
let nCorners = 0
let nTris = 0

const growCorners = () => {
  if (nCorners + 3 <= faceCorners.length) return
  const next = new Int32Array(faceCorners.length * 2)
  next.set(faceCorners)
  faceCorners = next
}

for (let li = 0; li < lines.length; li++) {
  const line = lines[li]
  if (line.length < 2) continue
  const c0 = line.charCodeAt(0)
  if (c0 === 118) {
    // 'v'
    const c1 = line.charCodeAt(1)
    if (c1 === 32) {
      // 'v ' vertex
      const t = line.split(' ')
      rv.push(parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3]))
    } else if (c1 === 116) {
      // 'vt' uv
      const t = line.split(' ')
      rvt.push(parseFloat(t[1]), parseFloat(t[2]))
    } else if (c1 === 110) {
      // 'vn' normal
      const t = line.split(' ')
      rvn.push(parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3]))
    }
  } else if (c0 === 102 && line.charCodeAt(1) === 32) {
    // 'f ' face — fan triangulate
    const t = line.split(' ')
    const nv = t.length - 1
    const corners: number[][] = []
    for (let i = 1; i <= nv; i++) {
      const p = t[i].split('/')
      corners.push([
        parseInt(p[0], 10),
        p.length > 1 && p[1] ? parseInt(p[1], 10) : 0,
        p.length > 2 && p[2] ? parseInt(p[2], 10) : 0,
      ])
    }
    for (let j = 1; j < nv - 1; j++) {
      growCorners()
      for (const c of [corners[0], corners[j], corners[j + 1]]) {
        faceCorners[nCorners++] = c[0]
        faceCorners[nCorners++] = c[1]
        faceCorners[nCorners++] = c[2]
      }
      nTris++
    }
  }
  // ignore everything else (l lines, usemtl, …)
}
console.log(`raw: v=${rv.length / 3} vt=${rvt.length / 2} vn=${rvn.length / 3} tris=${nTris} corners=${nCorners / 3}`)

// ---- bbox of raw vertices, center X/Z, ground → y=0 ----
let minX = Infinity, minY = Infinity, minZ = Infinity
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
for (let i = 0; i < rv.length; i += 3) {
  const x = rv[i], y = rv[i + 1], z = rv[i + 2]
  if (x < minX) minX = x; if (x > maxX) maxX = x
  if (y < minY) minY = y; if (y > maxY) maxY = y
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
}
const cx = (minX + maxX) / 2
const cz = (minZ + maxZ) / 2
const H = maxY - minY
console.log(`raw bbox: h=${H.toFixed(3)} x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}] z[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`)

// ---- dedupe corners → indexed arrays ----
console.log('deduplicating corners…')
const map = new Map<string, number>()
const outPos: number[] = []
const outNrm: number[] = []
const outUv: number[] = []
const indices = new Uint32Array(nCorners / 3)
for (let c = 0, w = 0; c < nCorners; c += 3, w++) {
  const vi = faceCorners[c], ti = faceCorners[c + 1], ni = faceCorners[c + 2]
  const key = vi + '|' + ti + '|' + ni
  let idx = map.get(key)
  if (idx === undefined) {
    idx = outPos.length / 3
    map.set(key, idx)
    const vBase = (vi - 1) * 3
    outPos.push(rv[vBase] - cx, rv[vBase + 1] - minY, rv[vBase + 2] - cz)
    if (ni > 0) {
      const nBase = (ni - 1) * 3
      outNrm.push(rvn[nBase], rvn[nBase + 1], rvn[nBase + 2])
    } else {
      outNrm.push(0, 1, 0)
    }
    if (ti > 0) {
      const tBase = (ti - 1) * 2
      outUv.push(rvt[tBase], rvt[tBase + 1])
    } else {
      outUv.push(0, 0)
    }
  }
  indices[w] = idx
}
const nVerts = outPos.length / 3
console.log(`indexed: verts=${nVerts} (${((nVerts / (nCorners / 3)) * 100).toFixed(0)}% of corners) tris=${nTris}`)

// ---- slice histogram on final positions ----
const SLICES = 28
const maxRSlice = new Array(SLICES).fill(0)
for (let i = 0; i < outPos.length; i += 3) {
  const y = outPos[i + 1]
  const s = Math.min(SLICES - 1, Math.max(0, Math.floor((y / H) * SLICES)))
  const r = Math.hypot(outPos[i], outPos[i + 2])
  if (r > maxRSlice[s]) maxRSlice[s] = r
}
console.log('slice table (fraction of height → max radius):')
for (let i = 0; i < SLICES; i++) {
  const f = ((i + 0.5) / SLICES).toFixed(3)
  console.log(`  y=${f}  r=${maxRSlice[i].toFixed(2)}  ${'█'.repeat(Math.round((maxRSlice[i] / 4.5) * 40))}`)
}

// ---- pack GLB ----
console.log('packing GLB…')
const pos = new Float32Array(outPos)
const nrm = new Float32Array(outNrm)
const uv = new Float32Array(outUv)
const idx = indices

const chunk = (arr: Float32Array | Uint32Array) =>
  new Uint8Array(arr.buffer as ArrayBuffer, arr.byteOffset, arr.byteLength)
const bufIdx = chunk(idx)
const bufPos = chunk(pos)
const bufNrm = chunk(nrm)
const bufUv = chunk(uv)
const pad4 = (n: number) => (4 - (n % 4)) % 4

const views: Record<string, number>[] = []
let off = 0
const addView = (u8: Uint8Array) => {
  off += pad4(off)
  views.push({ buffer: 0, byteOffset: off, byteLength: u8.byteLength })
  off += u8.byteLength
  return views.length - 1
}
const vIdx = addView(bufIdx)
const vPos = addView(bufPos)
const vNrm = addView(bufNrm)
const vUv = addView(bufUv)
const totalBin = off + pad4(off)

let minP = [Infinity, Infinity, Infinity]
let maxP = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < pos.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    if (pos[i + k] < minP[k]) minP[k] = pos[i + k]
    if (pos[i + k] > maxP[k]) maxP[k] = pos[i + k]
  }
}

const gltf = {
  asset: { version: '2.0', generator: 'lander obj2glb (indexed)' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'LanderAsset' }],
  meshes: [{
    name: 'Lander',
    primitives: [{
      attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
      indices: 0,
      material: 0,
      mode: 4,
    }],
  }],
  materials: [{
    name: 'LanderBase',
    pbrMetallicRoughness: { baseColorFactor: [0.62, 0.65, 0.69, 1], metallicFactor: 0.7, roughnessFactor: 0.45 },
    doubleSided: false,
  }],
  buffers: [{ byteLength: totalBin }],
  bufferViews: views,
  accessors: [
    { bufferView: vIdx, componentType: 5125, count: idx.length, type: 'SCALAR' },
    { bufferView: vPos, componentType: 5126, count: nVerts, type: 'VEC3', min: minP, max: maxP },
    { bufferView: vNrm, componentType: 5126, count: nVerts, type: 'VEC3' },
    { bufferView: vUv, componentType: 5126, count: nVerts, type: 'VEC2' },
  ],
}

let jsonBuf = new TextEncoder().encode(JSON.stringify(gltf))
if (pad4(jsonBuf.byteLength)) {
  // re-encode padded with spaces (allowed by spec)
  const padded = JSON.stringify(gltf) + ' '.repeat(pad4(JSON.stringify(gltf).length))
  jsonBuf = new TextEncoder().encode(padded)
}
const binPadded = new Uint8Array(totalBin)
binPadded.set(bufIdx, views[0].byteOffset)
binPadded.set(bufPos, views[1].byteOffset)
binPadded.set(bufNrm, views[2].byteOffset)
binPadded.set(bufUv, views[3].byteOffset)

const headerLen = 12 + 8 + jsonBuf.byteLength + 8 + totalBin
const glb = new Uint8Array(headerLen)
const dv = new DataView(glb.buffer)
dv.setUint32(0, 0x46546C67, true) // 'glTF'
dv.setUint32(4, 2, true)
dv.setUint32(8, headerLen, true)
dv.setUint32(12, jsonBuf.byteLength, true)
dv.setUint32(16, 0x4E4F534A, true) // 'JSON'
glb.set(jsonBuf, 20)
const binOff = 20 + jsonBuf.byteLength
dv.setUint32(binOff, totalBin, true)
dv.setUint32(binOff + 4, 0x004E4942, true) // 'BIN'
glb.set(binPadded, binOff + 8)

mkdirSync('/home/z/my-project/public/models', { recursive: true })
writeFileSync(OUT, glb)
console.log(`wrote ${OUT} (${(glb.byteLength / 1048576).toFixed(1)} MB)  height=${H.toFixed(3)} (ground→top), half-extent=${Math.max(Math.abs(minP[0]), maxP[0], Math.abs(minP[2]), maxP[2]).toFixed(2)}`)
