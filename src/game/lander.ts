// Lander dimensions — shared by the 3D asset, physics, cinematics and
// interactions so everything stays in agreement.
//
// The uploaded "realistic-lander" OBJ was converted to /models/lander.glb
// (scripts/convert-lander.ts): ground at y=0, height 5.535, leg half-span 3.17.
// Structural bands (fractions of height): legs 0–0.23, descent stage 0.23–0.55,
// ascent cabin 0.55–0.83, antenna mast 0.83–1.0.

export const LANDER_MODEL_URL = '/models/lander.glb'

/** GLB native height (ground → antenna tip). */
export const LANDER_RAW_H = 5.535

/** The astronaut model is normalized to 1.78 m (see Astronaut.tsx). */
export const HUMAN_HEIGHT = 1.78

/** User spec: the lander is 6× bigger than the human model. */
export const LANDER_HEIGHT = HUMAN_HEIGHT * 6 // 10.68 m

/** Uniform scale applied to the GLB. */
export const LANDER_SCALE = LANDER_HEIGHT / LANDER_RAW_H // ≈ 1.93

/** EVA keep-out radius (leg pads ≈ 6.1 m + margin). */
export const LANDER_FOOTPRINT = 6.7

/** Walkable radius inside the ascent cabin (cabin shell ≈ 3.1 m). */
export const LANDER_CABIN_R = 2.7

/** Cabin floor height above the landing pads (descent-stage deck ≈ 0.55 × H). */
export const LANDER_FLOOR = 5.95

/** Cabin ceiling (≈ 0.83 × H). */
export const LANDER_CEIL = 8.75

/** Ladder-base interaction anchor, local to the lander (front = +Z). */
export const LANDER_HATCH_ANCHOR: [number, number, number] = [0, 1.7, 5.35]

/** Where the player re-appears when leaving the cabin (distance from center). */
export const LANDER_EXIT_DIST = LANDER_FOOTPRINT + 1.5

/** Deployable spare-solar cargo pallet, local to the lander. */
export const LANDER_CARGO: [number, number, number] = [7.9, 0, 2.6]
