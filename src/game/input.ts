// Global keyboard/mouse input singleton read by the player controller.
const keys = new Set<string>()
const justPressed = new Set<string>()
let mouseDown = false
let rightDown = false

export const input = {
  install(): () => void {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return
      keys.add(e.code)
      justPressed.add(e.code)
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault()
    }
    const ku = (e: KeyboardEvent) => keys.delete(e.code)
    const md = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      if (e.button === 0) { mouseDown = true; justPressed.add('Mouse0') }
      if (e.button === 2) { rightDown = true; justPressed.add('Mouse2') }
    }
    const mu = (e: MouseEvent) => {
      if (e.button === 0) mouseDown = false
      if (e.button === 2) rightDown = false
    }
    const blur = () => { keys.clear(); mouseDown = false; rightDown = false }
    const ctx = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('mousedown', md)
    window.addEventListener('mouseup', mu)
    window.addEventListener('blur', blur)
    window.addEventListener('contextmenu', ctx)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('mousedown', md)
      window.removeEventListener('mouseup', mu)
      window.removeEventListener('blur', blur)
      window.removeEventListener('contextmenu', ctx)
    }
  },
  down(code: string): boolean { return keys.has(code) },
  pressed(code: string): boolean {
    if (justPressed.has(code)) { return true }
    return false
  },
  endFrame(): void { justPressed.clear() },
  get mouseLeft(): boolean { return mouseDown },
  get mouseRight(): boolean { return rightDown },
  clearKeys(): void { keys.clear() },
}
