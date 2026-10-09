// Validate the generated rover GLB structure
import { readFileSync } from 'node:fs'
const g = readFileSync('/home/z/my-project/public/models/rover/curiosity.glb')
const dv = new DataView(g.buffer, g.byteOffset, g.byteLength)
const magic = dv.getUint32(0, true), ver = dv.getUint32(4, true), total = dv.getUint32(8, true)
const jsonLen = dv.getUint32(12, true), jsonType = dv.getUint32(16, true)
console.log({ magic: magic.toString(16), ver, total, file: g.byteLength, jsonLen, jsonType: String.fromCharCode(jsonType & 255, (jsonType >> 8) & 255, (jsonType >> 16) & 255, (jsonType >> 24) & 255) })
const jsonStr = new TextDecoder().decode(g.subarray(20, 20 + jsonLen)).replace(/\s+$/, '')
const gltf = JSON.parse(jsonStr)
const binChunkOff = 20 + jsonLen
const binLen = dv.getUint32(binChunkOff, true)
const binType = dv.getUint32(binChunkOff + 4, true)
console.log({ binLen, binType: String.fromCharCode(binType & 255, (binType >> 8) & 255, (binType >> 16) & 255, (binType >> 24) & 255), declared: gltf.buffers[0].byteLength })
const binStart = binChunkOff + 8
const binEnd = binStart + binLen
console.log('binEnd vs file:', binEnd, g.byteLength, binEnd <= g.byteLength)
const SIZES: Record<string, number> = { '5120': 1, '5121': 1, '5122': 2, '5123': 2, '5125': 4, '5126': 4 }
const NUMC: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
let bad = 0
gltf.accessors.forEach((a: { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }, i: number) => {
  const bv = gltf.bufferViews[a.bufferView]
  const comp = SIZES[String(a.componentType)] * NUMC[a.type]
  const len = comp * a.count
  const start = binStart + bv.byteOffset + (a.byteOffset ?? 0)
  const end = start + len
  if (end > binEnd || bv.byteOffset % 4 !== 0) {
    bad++
    if (bad < 8) console.log(`BAD acc ${i}: start=${start} end=${end} > binEnd=${binEnd} align=${bv.byteOffset % 4} count=${a.count} type=${a.type} comp=${a.componentType}`)
  }
})
console.log('bad accessors:', bad, 'of', gltf.accessors.length)
// bufferView bounds vs bin
let badv = 0
gltf.bufferViews.forEach((bv: { byteOffset: number; byteLength: number }, i: number) => {
  if (binStart + bv.byteOffset + bv.byteLength > binEnd) { badv++; if (badv < 5) console.log('BAD view', i, bv.byteOffset, bv.byteLength) }
})
console.log('bad views:', badv, 'of', gltf.bufferViews.length)
