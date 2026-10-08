// Reproduce GLTFLoader parse of the rover GLB in bun to get the real stack
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js') as { GLTFLoader: new () => { parse: (d: ArrayBuffer, p: string, ok: (g: unknown) => void, err: (e: unknown) => void) => void } }

const buf = readFileSync('/home/z/my-project/public/models/rover/curiosity.glb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

const loader = new GLTFLoader()
loader.parse(ab, '', (g) => {
  const scenes = g as { scene: THREE.Group }
  let meshes = 0, verts = 0
  scenes.scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { meshes++; verts += (m.geometry.getAttribute('position')?.count ?? 0) }
  })
  console.log('PARSE OK meshes=', meshes, 'verts=', verts)
}, (e) => {
  console.error('PARSE FAIL', e)
  if (e instanceof Error) console.error(e.stack)
})
