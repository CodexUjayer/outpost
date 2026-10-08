// First-person astronaut body — built from the uploaded GLB astronaut model.
//
// The whole suited body (minus the head) is rendered slightly behind the camera so
// looking down shows the real suit, legs and boots. The body pitches gently around
// the collarbone when the camera looks up/down so the chest never fills the screen.
//
// Arms are posed every frame with an analytic 2-bone IK (law of cosines + elbow pole)
// and — critically — ROLL-CONTROLLED orientations: the hand's world rotation is built
// from the model's own rest-pose axes (finger axis + palm normal measured at build
// time) mapped onto camera-space targets, so the gloved hands always hold a stable,
// anatomically sane pose (fingers forward-down, palms facing inward) instead of the
// twisted palms-up "broken wrist" a minimal-arc rotation produces. The forearm uses
// the same basis-match so the sleeve cuff stays continuous with the glove. Finger
// bones are driven procedurally (gentle curl + grip on interact) for deterministic,
// natural hands.
//
// The head mesh (Object_11) is hidden; the camera sits at the model's eye height.
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getMats } from './materials'
import { useGame } from '@/game/store'
import { fpState } from './Player'
import {
  loadAstronautScene, cloneAstronaut, findBone,
  ASTRONAUT_BONES, ASTRONAUT_MESHES,
} from './Astronaut'

const EYE = 1.62
// body center sits this far behind the camera (horizontal distance). Must stay
// >= chest half-depth (~0.19 m) so the near plane (0.08) clips the chest instead
// of showing it, but small enough that the IK arms (0.50 m) reach the view frustum.
const BODY_BACK = 0.19
// looking down/up: the body leans around the collarbone and slides back so the
// camera never ends up inside the torso (and the boots stay on the ground).
const NECK_LEAN = 0.26 // rad of body lean per rad of camera pitch
const NECK_BACK = 0.22 // extra horizontal body offset per rad of down-pitch

// camera-space hand rest targets (right hand holds the tool, left supports)
// NOTE: elevation from view center must stay within ~±34° (75° vFOV) or the
// hands leave the frustum at neutral pitch.
const T_R = new THREE.Vector3(0.21, -0.1, -0.42)
const T_R_REACH = new THREE.Vector3(0.13, -0.09, -0.48)
const T_L = new THREE.Vector3(-0.21, -0.13, -0.36)

// camera-space orientation targets for the hands (roll-controlled):
// fingers point forward & slightly down; palms face each other, tipped down —
// the relaxed "ready" pose of a suited astronaut working in front of them.
const AIM_CAM = new THREE.Vector3(0, -0.26, -1).normalize()
const PALM_R_CAM = new THREE.Vector3(-0.94, -0.34, 0.05).normalize()
const PALM_L_CAM = new THREE.Vector3(0.94, -0.34, 0.05).normalize()

// tool/wrist view models are posed from the hand/forearm frames measured at
// build time (see buildFPBody) so they ride the gloves naturally
const Q_TOOL_LOCAL = new THREE.Quaternion()
const TOOL_OFFSET_LOCAL = new THREE.Vector3()
// wrist display rides the left forearm (screen on the back of the wrist)
const Q_WRIST_LOCAL = new THREE.Quaternion()
const WRIST_OFFSET_LOCAL = new THREE.Vector3()

// gentle per-joint curl (rad) for a relaxed gloved grip, scaled up while gripping
const FINGER_CURL: Record<string, number[]> = {
  Thumb: [0.12, 0.2, 0.14],
  Index: [0.38, 0.5, 0.3],
  Mid: [0.42, 0.54, 0.32],
  Ring: [0.44, 0.54, 0.32],
  Pinky: [0.32, 0.42, 0.26],
}
const FINGER_RE = /_(Index|Mid|Ring|Pinky|Thumb)(\d)_\d+$/

interface FingerJoint {
  bone: THREE.Bone
  q0: THREE.Quaternion // rest local rotation
  axis: THREE.Vector3 // bend axis in rest-local space (rotates fingertips toward the palm)
  base: number // base curl (rad)
  phase: number // idle wobble offset
  spreadAxis: THREE.Vector3 | null // joint-1 abduction correction (rest-local)
  spreadAmt: number
}

interface Chain {
  upper: THREE.Bone
  fore: THREE.Bone
  hand: THREE.Bone
  L1: number
  L2: number
  poleSide: number // +1 right arm, -1 left arm
  // hand-local rest frame (orthonormal, measured from the GLB bind pose)
  fLocal: THREE.Vector3 // along the middle finger
  pLocal: THREE.Vector3 // palm normal (faces the thigh at rest)
  sLocal: THREE.Vector3 // fLocal × pLocal
  tLocal: THREE.Vector3 // toward the thumb
  // forearm-local rest frame (orthonormal)
  aLocal: THREE.Vector3 // elbow → wrist
  u2Local: THREE.Vector3 // toward the thumb side (orthogonal to aLocal)
  v2Local: THREE.Vector3 // aLocal × u2Local
}

interface FPBody {
  outer: THREE.Group
  pivot: THREE.Group // collarbone pitch pivot
  neckY: number
  mixer: THREE.AnimationMixer | null
  chains: { r: Chain | null; l: Chain | null }
  fingers: FingerJoint[]
  legs: {
    thighL: THREE.Bone | null; calfL: THREE.Bone | null
    thighR: THREE.Bone | null; calfR: THREE.Bone | null
  }
  tool: THREE.Group
  weldMat: THREE.MeshStandardMaterial
}

// ----------------------------------------------------------------
// Multitool (procedural hardware held in the right glove)
// ----------------------------------------------------------------
function buildTool(): { tool: THREE.Group; weldMat: THREE.MeshStandardMaterial } {
  const m = getMats()
  const tool = new THREE.Group()
  tool.name = 'fpTool'

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.072, 0.16), m.hullDark)
  tool.add(body)
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.1), m.accentOrange)
  top.position.set(0, 0.045, 0.02)
  tool.add(top)
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.07), m.hullGray)
  jaw.position.set(0, 0.02, -0.1)
  jaw.rotation.x = 0.4
  tool.add(jaw)
  const weldMat = new THREE.MeshStandardMaterial({ color: '#888888', emissive: '#ffb050', emissiveIntensity: 0 })
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.08, 6), weldMat)
  tip.position.set(0.018, -0.02, -0.09)
  tip.rotation.x = 0.5
  tool.add(tip)
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.015, 10),
    new THREE.MeshStandardMaterial({ color: '#0d1210', emissive: '#3d5a3a', emissiveIntensity: 0.8 }),
  )
  lens.position.set(-0.02, 0.035, -0.05)
  lens.rotation.x = 0.9
  tool.add(lens)

  return { tool, weldMat }
}

// ----------------------------------------------------------------
// Basis match: quaternion R that maps the local orthonormal frame
// (fL,pL,sL) onto the world frame (fW,pW,sW). Unlike setFromUnitVectors
// (minimal arc), this fully controls roll — no more broken wrists.
// ----------------------------------------------------------------
const _bmL = new THREE.Matrix4()
const _bmW = new THREE.Matrix4()
function basisMatch(
  fL: THREE.Vector3, pL: THREE.Vector3, sL: THREE.Vector3,
  fW: THREE.Vector3, pW: THREE.Vector3, sW: THREE.Vector3,
  out: THREE.Quaternion,
) {
  _bmL.makeBasis(fL, pL, sL)
  _bmW.makeBasis(fW, pW, sW)
  _bmL.transpose()
  _bmW.multiply(_bmL)
  out.setFromRotationMatrix(_bmW)
  return out
}

// ----------------------------------------------------------------
// Finger rig: collect the model's finger joints and measure each
// joint's bend axis (rotates the down-chain direction toward the palm).
// ----------------------------------------------------------------
function collectFingers(
  hand: THREE.Bone,
  palmW: THREE.Vector3,
  midDirW: THREE.Vector3,
  phaseSeed: number,
): FingerJoint[] {
  const out: FingerJoint[] = []
  const isFinger = (n: string) => FINGER_RE.test(n) && !n.includes('scaleCompensation')
  const bones: THREE.Bone[] = []
  hand.traverse((o) => {
    const b = o as THREE.Bone
    if (b.isBone && isFinger(b.name)) bones.push(b)
  })
  const handP = hand.getWorldPosition(new THREE.Vector3())
  bones.forEach((b, i) => {
    const m = b.name.match(FINGER_RE)!
    const kind = m[1]
    const ji = Math.max(0, parseInt(m[2], 10) - 1)
    const bp = b.getWorldPosition(new THREE.Vector3())
    const bq = b.getWorldQuaternion(new THREE.Quaternion())
    // down-chain direction, expressed in this bone's rest-local space
    const childBone = b.children.find(
      (c) => (c as THREE.Bone).isBone && isFinger(c.name),
    ) as THREE.Bone | undefined
    let dW: THREE.Vector3 | null = null
    if (childBone) {
      dW = childBone.getWorldPosition(new THREE.Vector3()).sub(bp)
    } else {
      // distal joint — continue the parent joint's direction
      const pj = b.parent?.parent as THREE.Bone | undefined
      if (pj && pj.isBone) dW = bp.clone().sub(pj.getWorldPosition(new THREE.Vector3()))
    }
    const inv = bq.clone().invert()
    const dL = (dW ?? new THREE.Vector3(0, 1, 0)).applyQuaternion(inv).normalize()
    const pL = palmW.clone().applyQuaternion(inv).normalize()
    const axis = new THREE.Vector3().crossVectors(dL, pL)
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1)
    axis.normalize()
    const curls = FINGER_CURL[kind] ?? [0.3, 0.4, 0.25]

    // abduction correction on the first joint: the GLB's bind pose has a wide
    // mannequin finger fan (~80°) — pull each finger 75% of the way back toward
    // the middle finger (rotation about the palm normal within the palm plane)
    let spreadAxis: THREE.Vector3 | null = null
    let spreadAmt = 0
    if (ji === 0 && kind !== 'Thumb') {
      const dirW = bp.clone().sub(handP).normalize()
      const cross = new THREE.Vector3().crossVectors(midDirW, dirW)
      const signed = Math.atan2(cross.dot(palmW), midDirW.dot(dirW))
      if (Math.abs(signed) > 0.02) {
        spreadAxis = palmW.clone().applyQuaternion(inv).normalize()
        spreadAmt = -signed * 0.75
      }
    }

    out.push({
      bone: b,
      q0: b.quaternion.clone(),
      axis,
      base: curls[Math.min(ji, curls.length - 1)],
      phase: phaseSeed + i * 0.83,
      spreadAxis,
      spreadAmt,
    })
  })
  return out
}

// ----------------------------------------------------------------
// Build the first-person body from the GLB
// ----------------------------------------------------------------
function buildFPBody(src: { scene: THREE.Group; animations: THREE.AnimationClip[] }): FPBody | null {
  // The mocap idle clip animates the arm/hand/finger joints — INCLUDING the
  // *_scaleCompensation wrapper nodes that carry the finger joint positions.
  // At 45% blend that drags the gloves into a splayed fan that the procedural
  // finger rig (which only writes the plain finger bones) can never cancel.
  // → idle for the FP body keeps torso/leg/neck tracks only; arms+hands are
  //   fully procedural (IK + finger rig) and stay in the bind pose.
  const IDLE_STRIP = /(Upperarm|Forearm|Hand_\d|Clavicle|Thumb\d|Index\d|Mid\d|Ring\d|Pinky\d|Twist)/
  const srcClip = src.animations[0]
  const idleClip = srcClip
    ? new THREE.AnimationClip(
        'fpIdle',
        srcClip.duration,
        srcClip.tracks.filter((tr) => !IDLE_STRIP.test(tr.name)),
      )
    : null
  const acl = cloneAstronaut(src, { idle: true, animWeight: 0.45, animClip: idleClip ?? undefined })
  const outer = acl.root

  // hide the head (the camera sits at its height)
  const head = outer.getObjectByName(ASTRONAUT_MESHES.head)
  if (head) head.visible = false

  outer.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isMesh) {
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
    }
  })

  // collarbone pitch pivot: reparent the model so looking up/down leans the
  // torso around the neck instead of swinging the whole body from the feet
  let neckY = 1.42
  const torso = outer.getObjectByName(ASTRONAUT_MESHES.torso) as THREE.Mesh | undefined
  if (torso?.geometry) {
    if (!torso.geometry.boundingBox) torso.geometry.computeBoundingBox()
    const bb = torso.geometry.boundingBox!.clone().applyMatrix4(torso.matrixWorld)
    neckY = THREE.MathUtils.clamp(bb.max.y - 0.1, 1.0, 1.6)
  }
  const model = outer.children[0]
  if (!model) return null
  outer.remove(model)
  const pivot = new THREE.Group()
  pivot.name = 'fpPitchPivot'
  pivot.position.y = neckY
  model.position.y -= neckY
  pivot.add(model)
  outer.add(pivot)

  outer.updateWorldMatrix(true, true) // rest-pose world matrices

  const upperR = findBone(outer, ASTRONAUT_BONES.upperR)
  const foreR = findBone(outer, ASTRONAUT_BONES.foreR)
  const handR = findBone(outer, ASTRONAUT_BONES.handR)
  const upperL = findBone(outer, ASTRONAUT_BONES.upperL)
  const foreL = findBone(outer, ASTRONAUT_BONES.foreL)
  const handL = findBone(outer, ASTRONAUT_BONES.handL)
  if (!upperR || !foreR || !handR || !upperL || !foreL || !handL) {
    console.warn('[fp-body] arm bones not found in astronaut GLB')
    return null
  }

  // Measure each arm's rest-pose frames. The model faces +Z with arms hanging
  // at the sides (palms toward the thighs) — verified against the GLB.
  const mkChain = (upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, poleSide: number): Chain => {
    const upperP = upper.getWorldPosition(new THREE.Vector3())
    const foreP = fore.getWorldPosition(new THREE.Vector3())
    const handP = hand.getWorldPosition(new THREE.Vector3())
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion())
    const foreQ = fore.getWorldQuaternion(new THREE.Quaternion())

    // finger + thumb axes from the first finger/thumb joints (wrapper nodes
    // carry the joint translation, so their world positions are the joints)
    const mid = hand.children.find((c) => /Mid1/.test(c.name))!
    const thumb = hand.children.find((c) => /Thumb1/.test(c.name))!
    const fW = mid.getWorldPosition(new THREE.Vector3()).sub(handP).normalize()
    const tW = thumb.getWorldPosition(new THREE.Vector3()).sub(handP).normalize()

    // palm normal ⟂ fingers, signed so it faces the body axis (palms inward at rest)
    const pW = new THREE.Vector3().crossVectors(fW, tW).normalize()
    const inward = new THREE.Vector3(-Math.sign(handP.x) || 1, 0, 0)
    if (pW.dot(inward) < 0) pW.negate()
    pW.addScaledVector(fW, -pW.dot(fW)).normalize()

    const invH = handQ.invert()
    const fLocal = fW.clone().applyQuaternion(invH)
    const pLocal = pW.clone().applyQuaternion(invH)
    const sLocal = new THREE.Vector3().crossVectors(fLocal, pLocal)
    const tLocal = tW.clone().applyQuaternion(invH)

    // forearm frame: bone axis + thumb-side reference (keeps the cuff aligned)
    const aW = handP.clone().sub(foreP).normalize()
    const u2W = thumb.getWorldPosition(new THREE.Vector3()).sub(foreP)
    u2W.addScaledVector(aW, -u2W.dot(aW)).normalize()
    const invF = foreQ.invert()
    const aLocal = aW.clone().applyQuaternion(invF)
    const u2Local = u2W.clone().applyQuaternion(invF)
    const v2Local = new THREE.Vector3().crossVectors(aLocal, u2Local)

    return {
      upper, fore, hand, poleSide,
      L1: foreP.distanceTo(upperP),
      L2: handP.distanceTo(foreP),
      fLocal, pLocal, sLocal, tLocal,
      aLocal, u2Local, v2Local,
    }
  }

  const chains = {
    r: mkChain(upperR, foreR, handR, 1),
    l: mkChain(upperL, foreL, handL, -1),
  }

  // finger rigs (palm normal + middle-finger direction in world rest space)
  const fingers: FingerJoint[] = []
  for (const [hand, chain, seed] of [
    [handR, chains.r, 0],
    [handL, chains.l, 2.4],
  ] as const) {
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion())
    const palmW = chain.pLocal.clone().applyQuaternion(handQ)
    const mid1 = hand.children.find((c) => /Mid1/.test(c.name))!
    const midDirW = mid1.getWorldPosition(new THREE.Vector3())
      .sub(hand.getWorldPosition(new THREE.Vector3())).normalize()
    fingers.push(...collectFingers(hand, palmW, midDirW, seed))
  }

  // multitool grip frame: tool forward (−Z) along the right fingers, +Y toward
  // the thumb, sitting just above the palm center
  {
    const f = chains.r.fLocal
    const tUp = chains.r.tLocal.clone().addScaledVector(f, -chains.r.tLocal.dot(f)).normalize()
    const xT = new THREE.Vector3().crossVectors(tUp, f.clone().negate())
    basisMatch(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1),
      xT, tUp, f.clone().negate(),
      Q_TOOL_LOCAL,
    )
    TOOL_OFFSET_LOCAL.copy(f).multiplyScalar(0.038)
  }
  // wrist display frame: rides the left forearm — long axis along the bone,
  // screen facing the back of the wrist (opposite the palm)
  {
    const foreQ = foreL.getWorldQuaternion(new THREE.Quaternion())
    const aL = chains.l.aLocal
    // palm normal expressed in forearm-local space, then flipped = back of hand
    const backL = chains.l.pLocal.clone().applyQuaternion(
      handL.getWorldQuaternion(new THREE.Quaternion()),
    ).applyQuaternion(foreQ.clone().invert()).negate()
    const xT = aL.clone().negate()
    const zT = backL.addScaledVector(aL, -backL.dot(aL)).normalize()
    const yT = new THREE.Vector3().crossVectors(zT, xT).normalize()
    basisMatch(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1),
      xT, yT, zT,
      Q_WRIST_LOCAL,
    )
    WRIST_OFFSET_LOCAL.copy(zT).multiplyScalar(0.045)
  }

  const legs = {
    thighL: findBone(outer, ASTRONAUT_BONES.thighL),
    calfL: findBone(outer, ASTRONAUT_BONES.calfL),
    thighR: findBone(outer, ASTRONAUT_BONES.thighR),
    calfR: findBone(outer, ASTRONAUT_BONES.calfR),
  }

  const hw = buildTool()

  return {
    outer, pivot, neckY,
    mixer: acl.mixer,
    chains,
    fingers,
    legs,
    tool: hw.tool,
    weldMat: hw.weldMat,
  }
}

// ----------------------------------------------------------------
// Module-level cache: React StrictMode double-invokes render, so the
// body must be built exactly once and returned identically on both passes
// (a useRef guard makes the second pass return null → the <primitive> never
// mounts and the body silently never renders).
const fpBodyCache: { body: FPBody | null } = { body: null }

export default function Arms() {
  const { camera } = useThree()
  const [src, setSrc] = useState<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>(null)
  const bodyRef = useRef<FPBody | null>(null)
  const toolRoot = useRef<THREE.Group | null>(null)
  const wristRoot = useRef<THREE.Group | null>(null)
  const lampRef = useRef<THREE.PointLight>(null)
  const yawSmooth = useRef<number | null>(null)
  const leanSmooth = useRef(0)

  useEffect(() => {
    let live = true
    loadAstronautScene()
      .then((s) => {
        if (live) setSrc(s)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const built = useMemo(() => {
    if (!src) return null
    if (!fpBodyCache.body) fpBodyCache.body = buildFPBody(src)
    return fpBodyCache.body
  }, [src])

  // keep the frame-loop's view of the body in sync with what is mounted
  bodyRef.current = built
  // debug probe for browser automation
  useEffect(() => {
    ;(window as unknown as { __fpBody?: unknown }).__fpBody = built
  }, [built])

  // scratch objects (no per-frame allocation)
  const t = useMemo(() => ({
    S: new THREE.Vector3(), E: new THREE.Vector3(), H: new THREE.Vector3(),
    dir: new THREE.Vector3(), pole: new THREE.Vector3(), n: new THREE.Vector3(),
    u1: new THREE.Vector3(), u2: new THREE.Vector3(), upperDir: new THREE.Vector3(),
    curU: new THREE.Vector3(), elbow: new THREE.Vector3(),
    foreDir: new THREE.Vector3(), target: new THREE.Vector3(),
    fW: new THREE.Vector3(), pW: new THREE.Vector3(), sW: new THREE.Vector3(),
    tW: new THREE.Vector3(), v2: new THREE.Vector3(),
    fwd: new THREE.Vector3(), right: new THREE.Vector3(),
    camPos: new THREE.Vector3(), swing: new THREE.Vector3(),
    qU: new THREE.Quaternion(), qPU: new THREE.Quaternion(),
    qPF: new THREE.Quaternion(), qPH: new THREE.Quaternion(),
    Qd1: new THREE.Quaternion(), Qd2: new THREE.Quaternion(),
    qA: new THREE.Quaternion(), qB: new THREE.Quaternion(), qC: new THREE.Quaternion(),
    qD: new THREE.Quaternion(), qI: new THREE.Quaternion(),
    qHandD: new THREE.Quaternion(), qForeD: new THREE.Quaternion(),
  }), [])

  useFrame((_, dtRaw) => {
    const b = bodyRef.current
    const st = useGame.getState()
    const dt = Math.min(dtRaw, 0.05)
    const now = performance.now()

    const visible = !!b && st.screen === 'playing' && !st.driving && !st.construction
    if (b) {
      b.outer.visible = visible
      b.tool.visible = visible
    }
    if (wristRoot.current) wristRoot.current.visible = visible
    if (lampRef.current) lampRef.current.visible = visible
    if (!b || !visible) return

    // ---- idle animation (subtle life; arms/fingers are overridden below) ----
    if (b.mixer) b.mixer.update(dt)

    const cam = camera as THREE.PerspectiveCamera
    cam.updateMatrixWorld()
    cam.getWorldDirection(t.fwd)
    t.right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    t.camPos.setFromMatrixPosition(cam.matrixWorld)

    // ---- body follows camera (yaw slightly lagged = suit inertia) ----
    const targetYaw = Math.atan2(t.fwd.x, t.fwd.z)
    if (yawSmooth.current === null) yawSmooth.current = targetYaw
    let dy = targetYaw - yawSmooth.current
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    yawSmooth.current += dy * Math.min(1, dt * 9)
    b.outer.rotation.y = yawSmooth.current
    // lean around the collarbone when pitching up/down, keep the boots planted
    const leanT = THREE.MathUtils.clamp(-fpState.pitch * NECK_LEAN, -0.42, 0.5)
    leanSmooth.current += (leanT - leanSmooth.current) * Math.min(1, dt * 6)
    b.pivot.rotation.x = leanSmooth.current
    const sink = (1 - Math.cos(leanSmooth.current)) * b.neckY
    // constant horizontal trailing distance (normalized so steep pitch doesn't
    // collapse the offset and put the camera inside the chest)
    const back = BODY_BACK + Math.max(0, -fpState.pitch) * NECK_BACK
    const hl = Math.hypot(t.fwd.x, t.fwd.z) || 1
    b.outer.position.set(
      t.camPos.x - (t.fwd.x / hl) * back,
      t.camPos.y - EYE - sink,
      t.camPos.z - (t.fwd.z / hl) * back,
    )

    // ---- procedural walk (thigh/calf swing, low-gravity gait) ----
    const k = Math.min(1, fpState.speed / 3.4)
    if (k > 0.02 && fpState.grounded) {
      const ph = fpState.walkPhase
      const swing = (thigh: THREE.Bone | null, calf: THREE.Bone | null, phase: number) => {
        if (!thigh || !calf) return
        const aThigh = Math.sin(phase) * 0.5 * k
        t.S.setFromMatrixPosition(thigh.matrixWorld)
        t.E.setFromMatrixPosition(calf.matrixWorld)
        t.dir.subVectors(t.E, t.S).normalize()
        t.swing.copy(t.dir).applyAxisAngle(t.right, aThigh)
        thigh.getWorldQuaternion(t.qU)
        t.Qd1.setFromUnitVectors(t.dir, t.swing)
        t.qA.multiplyQuaternions(t.Qd1, t.qU)
        thigh.parent!.getWorldQuaternion(t.qB)
        t.qC.copy(t.qB).invert().multiply(t.qA)
        thigh.quaternion.copy(t.qC)
        // knee bend
        const foot = calf.children.find((c) => (c as THREE.Bone).isBone)
        if (foot) {
          const aCalf = Math.max(0, Math.sin(phase + 0.9)) * 0.62 * k + 0.06
          t.S.setFromMatrixPosition(calf.matrixWorld)
          foot.updateWorldMatrix(true, false)
          t.E.setFromMatrixPosition(foot.matrixWorld)
          t.dir.subVectors(t.E, t.S).normalize()
          t.swing.copy(t.dir).applyAxisAngle(t.right, -aCalf)
          calf.getWorldQuaternion(t.qU)
          t.Qd2.setFromUnitVectors(t.dir, t.swing)
          t.qA.multiplyQuaternions(t.Qd2, t.qU)
          // parent chain contains the thigh we just rotated
          calf.parent!.getWorldQuaternion(t.qB)
          t.qC.copy(t.qB).invert()
          t.qD.copy(t.Qd1).invert()
          t.qC.multiply(t.qD).multiply(t.qA)
          calf.quaternion.copy(t.qC)
        }
      }
      swing(b.legs.thighL, b.legs.calfL, ph)
      swing(b.legs.thighR, b.legs.calfR, ph + Math.PI)
    }

    // refresh world matrices after animation + leg writes
    b.outer.updateWorldMatrix(true, true)

    // ---- IK arms (roll-controlled) ----
    const reach = fpState.reach
    const aimPos = st.interaction?.pos ?? null
    const solve = (c: Chain) => {
      c.upper.updateWorldMatrix(true, false)
      t.S.setFromMatrixPosition(c.upper.matrixWorld)
      c.fore.updateWorldMatrix(true, false)
      t.E.setFromMatrixPosition(c.fore.matrixWorld)
      c.hand.updateWorldMatrix(true, false)
      t.H.setFromMatrixPosition(c.hand.matrixWorld)

      // hand anchor target in camera space (+ breathing)
      if (c.poleSide > 0) t.target.copy(T_R).lerp(T_R_REACH, reach)
      else t.target.copy(T_L)
      t.target.applyMatrix4(cam.matrixWorld)
      t.target.y += Math.sin(now / 780) * 0.004

      // pole (elbows point out+down)
      t.pole.copy(t.right).multiplyScalar(c.poleSide)
      t.pole.y -= 0.55
      t.pole.normalize()

      // clamp to reach
      t.dir.subVectors(t.target, t.S)
      let dist = t.dir.length()
      t.dir.divideScalar(dist || 1)
      const maxReach = (c.L1 + c.L2) * 0.985
      if (dist > maxReach) {
        dist = maxReach
        t.target.copy(t.S).addScaledVector(t.dir, dist)
      }

      // two-bone solve (law of cosines), elbow pushed toward the pole side
      const cosA1 = THREE.MathUtils.clamp((c.L1 * c.L1 + dist * dist - c.L2 * c.L2) / (2 * c.L1 * dist), -1, 1)
      const a1 = Math.acos(cosA1)
      t.n.crossVectors(t.pole, t.dir)
      if (t.n.lengthSq() < 1e-8) t.n.set(0, 1, 0).cross(t.dir)
      t.n.normalize()
      t.u1.copy(t.dir).applyAxisAngle(t.n, a1)
      t.u2.copy(t.dir).applyAxisAngle(t.n, -a1)
      t.upperDir.copy(t.u1.dot(t.pole) > t.u2.dot(t.pole) ? t.u1 : t.u2)
      t.elbow.copy(t.S).addScaledVector(t.upperDir, c.L1)
      t.foreDir.subVectors(t.target, t.elbow).normalize()

      // desired hand world frame: fingers → aim, palm → controlled inward tilt
      t.fW.copy(AIM_CAM).applyQuaternion(cam.quaternion)
      if (aimPos && reach > 0.25 && c.poleSide > 0) {
        t.u2.set(aimPos[0], aimPos[1], aimPos[2]).sub(t.H).normalize()
        t.fW.lerp(t.u2, reach * 0.8).normalize()
      }
      t.pW.copy(c.poleSide > 0 ? PALM_R_CAM : PALM_L_CAM).applyQuaternion(cam.quaternion)
      t.pW.addScaledVector(t.fW, -t.pW.dot(t.fW))
      if (t.pW.lengthSq() < 1e-6) t.pW.set(0, 1, 0).addScaledVector(t.fW, -t.fW.y)
      t.pW.normalize()
      t.sW.crossVectors(t.fW, t.pW)
      basisMatch(c.fLocal, c.pLocal, c.sLocal, t.fW, t.pW, t.sW, t.qHandD)

      // forearm frame: bone axis → elbow→target, thumb side matched to the hand
      // (keeps the sleeve cuff continuous with the glove, no twisted sleeve)
      t.tW.copy(c.tLocal).applyQuaternion(t.qHandD)
      t.u2.copy(t.tW).addScaledVector(t.foreDir, -t.tW.dot(t.foreDir))
      if (t.u2.lengthSq() < 1e-6) t.u2.copy(t.pW)
      t.u2.normalize()
      t.v2.crossVectors(t.foreDir, t.u2)
      basisMatch(c.aLocal, c.u2Local, c.v2Local, t.foreDir, t.u2, t.v2, t.qForeD)

      // write upper arm: minimal-arc from its mixer-animated pose (position is
      // pinned by the elbow solve; residual roll only affects the sleeve tube)
      t.curU.subVectors(t.E, t.S).normalize()
      t.Qd1.setFromUnitVectors(t.curU, t.upperDir)
      c.upper.getWorldQuaternion(t.qU)
      c.upper.parent!.getWorldQuaternion(t.qPU)
      t.qA.multiplyQuaternions(t.Qd1, t.qU)
      t.qI.copy(t.qPU).invert()
      c.upper.quaternion.copy(t.qI.multiply(t.qA))

      // write forearm + hand as absolute world frames (fresh parent chains)
      c.fore.parent!.updateWorldMatrix(true, false)
      c.fore.parent!.getWorldQuaternion(t.qPF)
      t.qI.copy(t.qPF).invert()
      c.fore.quaternion.copy(t.qI.multiply(t.qForeD))

      c.hand.parent!.updateWorldMatrix(true, false)
      c.hand.parent!.getWorldQuaternion(t.qPH)
      t.qI.copy(t.qPH).invert()
      c.hand.quaternion.copy(t.qI.multiply(t.qHandD))
    }
    if (b.chains.r) solve(b.chains.r)
    if (b.chains.l) solve(b.chains.l)

    // ---- procedural fingers: relaxed curl + grip while working ----
    const grip = 1 + reach * 0.6
    for (const j of b.fingers) {
      // the right hand carries the multitool: wrap the fingers around it even
      // at rest (thumb stays looser so it can still point along the tool)
      const right = j.bone.name.includes('_R_')
      const hold = right ? (/Thumb/.test(j.bone.name) ? 1.35 : 2.05) : 1
      t.qA.setFromAxisAngle(j.axis, j.base * hold * grip + Math.sin(now / 900 + j.phase) * 0.02)
      j.bone.quaternion.copy(j.q0)
      if (j.spreadAxis) {
        t.qB.setFromAxisAngle(j.spreadAxis, j.spreadAmt)
        j.bone.quaternion.multiply(t.qB)
      }
      j.bone.quaternion.multiply(t.qA)
    }

    // refresh once so view-model anchoring reads the solved pose
    b.outer.updateWorldMatrix(true, true)

    // ---- multitool: gripped in the right hand (moves with the glove) ----
    if (toolRoot.current && b.chains.r) {
      const handR = b.chains.r.hand
      handR.getWorldPosition(t.H)
      handR.getWorldQuaternion(t.qU)
      t.u2.copy(TOOL_OFFSET_LOCAL).applyQuaternion(t.qU)
      toolRoot.current.position.copy(t.H).add(t.u2)
      toolRoot.current.quaternion.copy(t.qU).multiply(Q_TOOL_LOCAL)
      // tool animation while working
      const holding = st.interactionProgress > 0
      const kind = st.interaction?.kind
      if (holding && kind === 'repair') {
        b.tool.rotation.z = Math.sin(now / 55) * 0.5
      } else if (holding && kind === 'leak') {
        b.tool.rotation.z = Math.sin(now / 30) * 0.05
        b.tool.rotation.x = Math.sin(now / 36) * 0.05
      } else {
        b.tool.rotation.z += (0 - b.tool.rotation.z) * Math.min(1, dt * 6)
        b.tool.rotation.x += (0 - b.tool.rotation.x) * Math.min(1, dt * 6)
      }
      b.weldMat.emissiveIntensity = kind === 'leak' && holding ? 1.5 + Math.random() * 2.2 : 0
    }
    // ---- wrist display: rides the back of the left wrist ----
    if (wristRoot.current && b.chains.l) {
      b.chains.l.hand.getWorldPosition(t.H)
      t.u2.copy(WRIST_OFFSET_LOCAL).applyQuaternion(t.qForeD)
      wristRoot.current.position.copy(t.H).add(t.u2)
      wristRoot.current.quaternion.copy(t.qForeD).multiply(Q_WRIST_LOCAL)
    }
    // helmet lamp rides just above the camera
    if (lampRef.current) {
      lampRef.current.position.copy(t.camPos).addScaledVector(t.fwd, 0.15)
    }
  })

  if (!built) return null
  return (
    <>
      <primitive object={built.outer} />
      {/* helmet lamp — subtle diegetic fill so the suit reads in shadow */}
      <pointLight ref={lampRef} intensity={0.55} distance={2.6} decay={1.6} color="#fff2dd" />
      <primitive
        object={built.tool}
        ref={(o: THREE.Group | null) => {
          toolRoot.current = o
        }}
      />
      <group
        ref={(o: THREE.Group | null) => {
          wristRoot.current = o
        }}
      >
        <mesh>
          <boxGeometry args={[0.072, 0.03, 0.042]} />
          <primitive object={getMats().hullDark} attach="material" />
        </mesh>
        <mesh position={[0, 0.009, 0.022]}>
          <boxGeometry args={[0.055, 0.02, 0.004]} />
          <primitive object={getMats().screenOn} attach="material" />
        </mesh>
      </group>
    </>
  )
}
