// GameRoot — Canvas + UI overlay + pointer lock + global input wiring.
'use client'
import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '@/game/store'
import { input } from '@/game/input'
import { audio } from '@/game/audio'
import Scene from './Scene'
import HUD from './HUD'
import BuildMenu from './BuildMenu'
import ColonyPanel from './ColonyPanel'
import Menus from './Menus'
import SkipButton from './SkipButton'
import VideoCutscene, { VideoPreload } from './VideoCutscene'
import ZoneFade from './ZoneFade'

function HelmetOverlay() {
  const inside = useGame((s) => s.inside)
  const screen = useGame((s) => s.screen)
  const driving = useGame((s) => s.driving)
  const show = screen === 'playing' && inside === null && !driving
  return (
    <div
      className={`fixed inset-0 z-30 pointer-events-none transition-opacity duration-1000 ${show ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background:
          'radial-gradient(ellipse 68% 62% at 50% 48%, transparent 58%, rgba(8,10,12,0.38) 80%, rgba(3,5,7,0.72) 100%), linear-gradient(to bottom, rgba(10,12,14,0.28) 0%, transparent 12%, transparent 88%, rgba(10,12,14,0.3) 100%)',
      }}
    />
  )
}

function ClickHint() {
  const [locked, setLocked] = useState(true)
  const screen = useGame((s) => s.screen)
  const paused = useGame((s) => s.paused)
  const construction = useGame((s) => s.construction)
  const driving = useGame((s) => s.driving)
  useEffect(() => {
    const f = () => setLocked(!!document.pointerLockElement)
    document.addEventListener('pointerlockchange', f)
    return () => document.removeEventListener('pointerlockchange', f)
  }, [])
  const show = screen === 'playing' && !paused && !construction && !driving && !locked
  if (!show) return null
  return (
    <div className="fixed inset-x-0 top-[56%] z-40 pointer-events-none flex justify-center">
      <div className="bg-stone-950/70 border border-stone-600/50 text-stone-200 font-mono text-xs px-4 py-2 rounded backdrop-blur">
        CLICK TO CAPTURE MOUSE — ESC TO PAUSE
      </div>
    </div>
  )
}

export default function GameRoot() {
  const wrap = useRef<HTMLDivElement>(null)
  const screen = useGame((s) => s.screen)

  useEffect(() => {
    const uninstall = input.install()

    // lightweight debug console for demos/testing: /?debug=1
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      ;(window as unknown as { __dbg?: unknown }).__dbg = {
        fill: () => useGame.setState((s) => ({
          res: {
            ...s.res,
            oxygen: { ...s.res.oxygen, amount: s.res.oxygen.cap },
            water: { ...s.res.water, amount: s.res.water.cap },
            food: { ...s.res.food, amount: s.res.food.cap },
            materials: { ...s.res.materials, amount: s.res.materials.cap },
          },
        })),
        phase: (p: number) => useGame.setState({ phase: p }),
        game: useGame,
        audio,
      }
    }

    const initAudio = () => {
      audio.init()
      audio.resume()
    }
    window.addEventListener('pointerdown', initAudio, { once: true })

    const onKey = (e: KeyboardEvent) => {
      const st = useGame.getState()
      if (e.code === 'KeyB' && st.screen === 'playing' && !st.construction && !st.paused) {
        st.toggleBuildMenu()
        // the menu needs a visible cursor
        if (!st.buildMenuOpen && document.pointerLockElement) document.exitPointerLock()
      }
      if (e.code === 'Tab' && st.screen === 'playing') {
        e.preventDefault()
        st.toggleColonyPanel()
        if (!st.colonyPanelOpen && document.pointerLockElement) document.exitPointerLock()
      }
      if (e.code === 'KeyT' && st.screen === 'playing') {
        const next = st.timeScale === 1 ? 4 : st.timeScale === 4 ? 12 : 1
        st.setTimeScale(next)
      }
      if (e.code === 'Escape') {
        if (st.placingType) st.cancelPlacement()
        else if (st.colonyPanelOpen) st.toggleColonyPanel(false)
        else if (st.buildMenuOpen) st.toggleBuildMenu(false)
      }
    }
    window.addEventListener('keydown', onKey)

    const onLockChange = () => {
      const st = useGame.getState()
      if (
        !document.pointerLockElement && st.screen === 'playing' && !st.paused &&
        !st.construction && !st.driving && !st.buildMenuOpen && !st.colonyPanelOpen
      ) {
        st.setPaused(true)
      }
    }
    document.addEventListener('pointerlockchange', onLockChange)

    // release pointer lock when a cinematic starts
    const unsub = useGame.subscribe((s, prev) => {
      if (s.construction && !prev.construction && document.pointerLockElement) {
        document.exitPointerLock()
      }
      if ((s.screen === 'landing' || s.screen === 'cutscene') && document.pointerLockElement) {
        document.exitPointerLock()
      }
    })

    return () => {
      uninstall()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('pointerdown', initAudio)
      unsub()
    }
  }, [])

  const requestLock = () => {
    audio.init()
    audio.resume()
    const st = useGame.getState()
    if (
      st.screen === 'playing' && !st.paused && !st.construction &&
      !st.buildMenuOpen && !st.colonyPanelOpen && !document.pointerLockElement
    ) {
      const canvas = wrap.current?.querySelector('canvas')
      canvas?.requestPointerLock()
    }
  }

  return (
    <div
      ref={wrap}
      className="fixed inset-0 bg-black select-none overflow-hidden"
      onMouseDown={requestLock}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 75, near: 0.08, far: 1600, position: [30, 8, 40] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.06
        }}
      >
        <Scene />
      </Canvas>
      <HelmetOverlay />
      <HUD />
      <BuildMenu />
      <ColonyPanel />
      <Menus />
      <SkipButton />
      <ClickHint />
      {screen === 'cutscene' && <VideoCutscene />}
      <ZoneFade />
      <VideoPreload />
    </div>
  )
}
