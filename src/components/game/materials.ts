// Shared PBR materials & procedural textures (canvas-generated, no external assets)
import * as THREE from 'three'

let cached: {
  hullWhite: THREE.MeshStandardMaterial
  hullWhiteBack: THREE.MeshStandardMaterial
  hullGray: THREE.MeshStandardMaterial
  hullDark: THREE.MeshStandardMaterial
  accentOrange: THREE.MeshStandardMaterial
  goldFoil: THREE.MeshStandardMaterial
  darkMetal: THREE.MeshStandardMaterial
  solarCell: THREE.MeshStandardMaterial
  solarFrame: THREE.MeshStandardMaterial
  glassHabitat: THREE.MeshStandardMaterial
  plantGreen: THREE.MeshStandardMaterial
  regolith: THREE.MeshStandardMaterial
  concrete: THREE.MeshStandardMaterial
  tire: THREE.MeshStandardMaterial
  screenOn: THREE.MeshStandardMaterial
  screenOff: THREE.MeshStandardMaterial
  interiorWall: THREE.MeshStandardMaterial
  fabric: THREE.MeshStandardMaterial
  glove: THREE.MeshStandardMaterial
  visor: THREE.MeshStandardMaterial
} | null = null

function makePanelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#cfccc4'
  g.fillRect(0, 0, 512, 512)
  // panel lines
  g.strokeStyle = 'rgba(70,70,66,0.55)'
  g.lineWidth = 3
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.stroke()
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke()
  }
  // rivets
  g.fillStyle = 'rgba(60,60,58,0.7)'
  for (let x = 32; x < 512; x += 64) {
    for (let y = 32; y < 512; y += 64) {
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill()
    }
  }
  // grime streaks
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const w = 2 + Math.random() * 5
    const h = 20 + Math.random() * 120
    g.fillStyle = `rgba(88,80,70,${0.04 + Math.random() * 0.09})`
    g.fillRect(x, y, w, h)
  }
  // subtle stains
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 20 + Math.random() * 60
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(96,84,66,0.10)')
    grad.addColorStop(1, 'rgba(96,84,66,0)')
    g.fillStyle = grad
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function makeRegolithTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#8f8b84'
  g.fillRect(0, 0, 512, 512)
  // grain
  for (let i = 0; i < 14000; i++) {
    const v = 100 + Math.random() * 90
    g.fillStyle = `rgba(${v},${v - 4},${v - 9},${0.16 + Math.random() * 0.2})`
    const s = Math.random() < 0.92 ? 1.4 : 3.2
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s)
  }
  // pebbles
  for (let i = 0; i < 320; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 1 + Math.random() * 3.4
    g.fillStyle = `rgba(${60 + Math.random() * 50},${58 + Math.random() * 45},${54 + Math.random() * 40},0.55)`
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // craters tiny
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 6 + Math.random() * 16
    const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r)
    grad.addColorStop(0, 'rgba(60,58,54,0.22)')
    grad.addColorStop(0.75, 'rgba(160,156,148,0.10)')
    grad.addColorStop(1, 'rgba(160,156,148,0)')
    g.fillStyle = grad
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

function makeCellTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#14181d'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(120,132,150,0.35)'
  g.lineWidth = 2
  for (let i = 0; i <= 6; i++) {
    g.beginPath(); g.moveTo(i * 42.6, 0); g.lineTo(i * 42.6, 256); g.stroke()
    g.beginPath(); g.moveTo(0, i * 42.6); g.lineTo(256, i * 42.6); g.stroke()
  }
  // subtle cell shine
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const grad = g.createLinearGradient(i * 42.6, j * 42.6, (i + 1) * 42.6, (j + 1) * 42.6)
      grad.addColorStop(0, 'rgba(70,84,105,0.30)')
      grad.addColorStop(1, 'rgba(20,24,30,0)')
      g.fillStyle = grad
      g.fillRect(i * 42.6 + 1, j * 42.6 + 1, 41, 41)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function getMats() {
  if (cached) return cached
  const panel = makePanelTexture()
  panel.repeat.set(1.4, 1.4)
  const rego = makeRegolithTexture()
  rego.repeat.set(30, 30)
  const cell = makeCellTexture()
  cached = {
    hullWhite: new THREE.MeshStandardMaterial({ color: '#d9d6cd', roughness: 0.62, metalness: 0.16, map: panel }),
    hullWhiteBack: new THREE.MeshStandardMaterial({ color: '#cfccc2', roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide, map: panel }),
    hullGray: new THREE.MeshStandardMaterial({ color: '#8d8d89', roughness: 0.55, metalness: 0.38 }),
    hullDark: new THREE.MeshStandardMaterial({ color: '#4c4d4f', roughness: 0.5, metalness: 0.55 }),
    accentOrange: new THREE.MeshStandardMaterial({ color: '#c9722e', roughness: 0.55, metalness: 0.25 }),
    goldFoil: new THREE.MeshStandardMaterial({ color: '#b28a3a', roughness: 0.35, metalness: 0.85 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#333538', roughness: 0.45, metalness: 0.7 }),
    solarCell: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.55, map: cell }),
    solarFrame: new THREE.MeshStandardMaterial({ color: '#9d9fa2', roughness: 0.4, metalness: 0.7 }),
    glassHabitat: new THREE.MeshStandardMaterial({ color: '#b8c4a8', roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    plantGreen: new THREE.MeshStandardMaterial({ color: '#5f8f42', roughness: 0.8, metalness: 0 }),
    regolith: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0.0, map: rego }),
    concrete: new THREE.MeshStandardMaterial({ color: '#98938a', roughness: 0.92, metalness: 0.02 }),
    tire: new THREE.MeshStandardMaterial({ color: '#2c2c2e', roughness: 0.9, metalness: 0.05 }),
    screenOn: new THREE.MeshStandardMaterial({ color: '#0d1210', roughness: 0.3, metalness: 0.2, emissive: '#3d5a3a', emissiveIntensity: 0.9 }),
    screenOff: new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.4, metalness: 0.3 }),
    interiorWall: new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.85, metalness: 0.05, side: THREE.BackSide }),
    fabric: new THREE.MeshStandardMaterial({ color: '#dedad0', roughness: 0.88, metalness: 0.02 }),
    glove: new THREE.MeshStandardMaterial({ color: '#b8b3a6', roughness: 0.75, metalness: 0.08 }),
    visor: new THREE.MeshStandardMaterial({ color: '#2a2620', roughness: 0.12, metalness: 0.9 }),
  }
  return cached
}

// Regolith-only texture for terrain
export function terrainTexture(): THREE.CanvasTexture {
  return makeRegolithTexture()
}
