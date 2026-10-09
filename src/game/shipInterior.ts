// Spaceship habitat deck — the real Spaceship.blend interior (public/models/ship/interior.glb).
//
// Source: upload/SpaceShip.blend, converted with tools/ship-convert.py.
//   1 Blender unit = 1 meter; glTF is Y-up (Blender (x, y, z) -> (x, z, -y)).
//   Deck floor ≈ y 0.05–0.12, ceiling ≈ 3.3 m, single walkable cross-shaped deck.
//   South round module = airlock (spawn/exit), north corridor = ops console bank,
//   west wing = cryo bay + emergency computer, east wing = galley commons.
//
// The model is placed in a buried "interior zone" below the terrain and reached
// through the existing teleport-interior architecture (same pattern as the lander
// cabin / storm shelter). Physics uses BVH-accelerated raycasts against the real
// geometry: floors from downward rays, walls/props from a ring of horizontal rays.
import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// wire three-mesh-bvh into three (idempotent)
type BufferGeometryWithBVH = THREE.BufferGeometry & {
  computeBoundsTree: typeof computeBoundsTree
  disposeBoundsTree: typeof disposeBoundsTree
  boundsTree?: unknown
}
type MeshWithRaycast = THREE.Mesh & { raycast: typeof acceleratedRaycast }
export function installBVHRaycast(): void {
  const g = THREE.BufferGeometry.prototype as BufferGeometryWithBVH
  if (!g.computeBoundsTree) {
    g.computeBoundsTree = computeBoundsTree
    g.disposeBoundsTree = disposeBoundsTree
  }
  const m = THREE.Mesh.prototype as MeshWithRaycast
  if (m.raycast !== acceleratedRaycast) {
    m.raycast = acceleratedRaycast
  }
}

export const SHIP_MODEL_URL = '/models/ship/interior.glb'

/** World position of the interior zone (buried well below the terrain). */
export const SHIP_ZONE = new THREE.Vector3(0, -40, 0)

/** Walkable deck AABB in glTF-local coordinates (from tools/ship_out_meta.json). */
export const SHIP_DECK_MIN = new THREE.Vector3(-8.6, -0.3, -12.7)
export const SHIP_DECK_MAX = new THREE.Vector3(8.6, 3.6, 11.2)

/** glTF-local interaction anchors (converted from Blender in the export step). */
export const SHIP_ANCHORS = {
  // inside the south round airlock module, a step north of its center — the
  // module floor is the ~0.1 deck level this y matches (the old z=3 anchor sat
  // on the 0.96 raised hall walkway, burying the player inside the slab and
  // wedged against bulkhead geometry). Faces north: inner hatch ahead, main
  // hall and ops console beyond — "you boarded, the ship is in front of you".
  spawn: new THREE.Vector3(0, 0.1, 7.0), // facing north (into the ship)
  exit: new THREE.Vector3(0, 2.3, 3.85), // raised: visible from the walkway above
  opsConsole: new THREE.Vector3(0, 1.05, -5.35),
  cryoBay: new THREE.Vector3(-5.0, 1.3, 1.5),
  emergency: new THREE.Vector3(-7.0, 1.0, -5.6),
  commons: new THREE.Vector3(4.4, 0.9, -2.3),
} as const

/** Player eye height (matches the EVA controller — real human scale). */
export const SHIP_EYE = 1.62

// ------------------------------------------------------------------
// BVH-backed collision registry — filled by ShipInterior once the GLB loads.
// ------------------------------------------------------------------
const meshes: THREE.Mesh[] = []
let lastFloorY = SHIP_ZONE.y + SHIP_ANCHORS.spawn.y
const DOWN = new THREE.Vector3(0, -1, 0)

export function registerShipMeshes(list: THREE.Mesh[]): void {
  meshes.length = 0
  meshes.push(...list)
}

/** Drop the registry (called on game restart so a rebuilt world re-registers). */
export function resetShipMeshes(): void {
  meshes.length = 0
  lastFloorY = SHIP_ZONE.y + SHIP_ANCHORS.spawn.y
}

/** Re-seed the floor fallback to the airlock deck (on boarding). */
export function resetShipFloor(): void {
  lastFloorY = SHIP_ZONE.y + SHIP_ANCHORS.spawn.y
}

const _inv = new THREE.Matrix4()
const _ray = new THREE.Ray()
const _normal = new THREE.Vector3()
const _origin = new THREE.Vector3()

/** Collect ALL world-space ray hits against the ship, closest-first. */
function raycastShipAll(origin: THREE.Vector3, dir: THREE.Vector3, far: number): { point: THREE.Vector3; distance: number; normal: THREE.Vector3 }[] {
  const hits: { point: THREE.Vector3; distance: number; normal: THREE.Vector3 }[] = []
  for (const m of meshes) {
    const bvh = (m.geometry as unknown as { boundsTree?: { raycast: (r: THREE.Ray, s: THREE.Side, n?: number, f?: number) => THREE.Intersection[] } }).boundsTree
    if (!bvh) continue
    _inv.copy(m.matrixWorld).invert()
    _ray.copy(new THREE.Ray(origin, dir)).applyMatrix4(_inv)
    const local = bvh.raycast(_ray, THREE.FrontSide, 0, far)
    for (const h of local) {
      const worldPoint = h.point.clone().applyMatrix4(m.matrixWorld)
      const d = worldPoint.distanceTo(origin)
      if (d > far) continue
      const n = _normal.copy(h.face ? h.face.normal : DOWN).transformDirection(m.matrixWorld).clone()
      hits.push({ point: worldPoint, distance: d, normal: n })
    }
  }
  hits.sort((a, b) => a.distance - b.distance)
  return hits
}

/** Ray vs the whole ship, closest hit only. */
function intersectShip(origin: THREE.Vector3, dir: THREE.Vector3, far: number) {
  const hits = raycastShipAll(origin, dir, far)
  return hits.length ? hits[0] : null
}

/**
 * Floor height under (x, z) on the ship deck. Collects every downward hit and
 * accepts only genuine deck-level surfaces (floor slabs, low steps, walkway
 * ramps) so ceilings / high props can never act as ground. Falls back to the
 * last known deck height so the player can never fall through geometry.
 */
const FLOOR_MIN_Y = SHIP_ZONE.y - 0.8 // sub-floor tolerance
const FLOOR_MAX_Y = SHIP_ZONE.y + 1.75 // raised walkways / ramps / low steps
export function shipFloorAt(px: number, py: number, pz: number): number {
  if (meshes.length === 0) return lastFloorY
  _origin.set(px, Math.max(py, lastFloorY) + 1.2, pz)
  const hits = raycastShipAll(_origin, DOWN, 12)
  let best = -Infinity
  for (const h of hits) {
    if (h.point.y < FLOOR_MIN_Y || h.point.y > FLOOR_MAX_Y) continue
    if (h.point.y > best) best = h.point.y
  }
  if (best > -Infinity) {
    lastFloorY = best
  }
  return lastFloorY
}

const WALL_DIST = 0.42
const WALL_HEIGHTS = [0.35, 1.15]
const _dir = new THREE.Vector3()
const _push = new THREE.Vector3()

/**
 * Push the player capsule out of walls / props. Casts a ring of horizontal rays
 * at knee and chest height and slides the position away from any hit closer
 * than the capsule radius. Mutates `pos` (x/z only).
 */
export function shipCollide(pos: THREE.Vector3): void {
  if (meshes.length === 0) return
  const steps = 10
  for (const h of WALL_HEIGHTS) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      _dir.set(Math.cos(a), 0, Math.sin(a))
      _origin.set(pos.x, pos.y - SHIP_EYE + h, pos.z)
      const hit = intersectShip(_origin, _dir, WALL_DIST)
      if (hit) {
        const depth = WALL_DIST - hit.distance
        if (depth > 0.001) {
          // push against the surface, flattening vertical influence
          _push.copy(hit.normal)
          _push.y = 0
          if (_push.lengthSq() < 1e-6) _push.copy(_dir).negate()
          _push.normalize().multiplyScalar(depth)
          pos.x += _push.x
          pos.z += _push.z
        }
      }
    }
  }
  // hard clamp to the deck volume as a final safety net
  pos.x = THREE.MathUtils.clamp(pos.x, SHIP_ZONE.x + SHIP_DECK_MIN.x + 0.3, SHIP_ZONE.x + SHIP_DECK_MAX.x - 0.3)
  pos.z = THREE.MathUtils.clamp(pos.z, SHIP_ZONE.z + SHIP_DECK_MIN.z + 0.3, SHIP_ZONE.z + SHIP_DECK_MAX.z - 0.3)
}

/** Recover the player if they somehow end up outside the deck volume. */
export function shipInsideBounds(x: number, y: number, z: number): boolean {
  return (
    x > SHIP_ZONE.x + SHIP_DECK_MIN.x - 1 &&
    x < SHIP_ZONE.x + SHIP_DECK_MAX.x + 1 &&
    z > SHIP_ZONE.z + SHIP_DECK_MIN.z - 1 &&
    z < SHIP_ZONE.z + SHIP_DECK_MAX.z + 1 &&
    y > SHIP_ZONE.y - 3 &&
    y < SHIP_ZONE.y + SHIP_DECK_MAX.y + 2
  )
}

/** World-space anchor (zone offset applied). */
export function shipWorldAnchor(key: keyof typeof SHIP_ANCHORS): [number, number, number] {
  const a = SHIP_ANCHORS[key]
  return [SHIP_ZONE.x + a.x, SHIP_ZONE.y + a.y, SHIP_ZONE.z + a.z]
}

/** Debug probe (?debug=1): wall-ray hits around a point. */
export function debugProbe(x: number, y: number, z: number): unknown {
  const out: unknown[] = []
  const dirs: [string, THREE.Vector3][] = [
    ['N', new THREE.Vector3(0, 0, -1)],
    ['S', new THREE.Vector3(0, 0, 1)],
    ['E', new THREE.Vector3(1, 0, 0)],
    ['W', new THREE.Vector3(-1, 0, 0)],
  ]
  for (const [label, d] of dirs) {
    for (const h of [0.35, 1.15]) {
      _origin.set(x, y - SHIP_EYE + h, z)
      const hit = intersectShip(_origin, d, 2.5)
      out.push({
        dir: label, h, dist: hit ? +hit.distance.toFixed(2) : null,
        n: hit ? [hit.normal.x.toFixed(1), hit.normal.y.toFixed(1), hit.normal.z.toFixed(1)] : null,
        py: hit ? +hit.point.y.toFixed(2) : null,
      })
    }
  }
  return out
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __shipProbe?: unknown }).__shipProbe = (x: number, y: number, z: number) => debugProbe(x, y, z)
  // ?debug=1 companion probe: deck floor height under a grid point (used to
  // map the walkable layout when authoring anchors)
  ;(window as unknown as { __shipFloor?: unknown }).__shipFloor = (x: number, z: number) => {
    const y = shipFloorAt(SHIP_ZONE.x + x, SHIP_ZONE.y + 1.6, SHIP_ZONE.z + z)
    return +(y - SHIP_ZONE.y).toFixed(2)
  }
}
