import { SimEngine, type Snapshot } from './SimEngine.js'
import { D3Renderer } from './D3Renderer.js'

let lastSnap: Snapshot | null = null
let paused = false

// DOM elements
const graphEl        = document.getElementById('graph')!
const chartsEl       = document.getElementById('charts')!
const killBtn        = document.getElementById('btn-kill')         as HTMLButtonElement
const recoverBtn     = document.getElementById('btn-recover')      as HTMLButtonElement
const killLbBtn      = document.getElementById('btn-kill-lb')      as HTMLButtonElement
const recoverLbBtn   = document.getElementById('btn-recover-lb')   as HTMLButtonElement
const killAppABtn    = document.getElementById('btn-kill-app-a')   as HTMLButtonElement
const killAppBBtn    = document.getElementById('btn-kill-app-b')   as HTMLButtonElement
const recoverAppsBtn = document.getElementById('btn-recover-apps') as HTMLButtonElement
const loadSlider     = document.getElementById('load-slider')      as HTMLInputElement
const loadValue      = document.getElementById('load-value')!
const playPauseBtn   = document.getElementById('btn-playpause')    as HTMLButtonElement
const timelineSlider = document.getElementById('timeline-slider')  as HTMLInputElement
const timelineTime   = document.getElementById('timeline-time')!

const renderer = new D3Renderer(graphEl, chartsEl)

const engine = new SimEngine((snap) => {
  lastSnap = snap
  if (!paused) {
    renderer.render(snap)
    updateButtons(snap)
    const hi = Math.max(engine.historyLength - 1, 0)
    timelineSlider.max   = String(hi)
    timelineSlider.value = String(hi)
    timelineTime.textContent = 'live'
  }
})

// ── Cache buttons ──
killBtn.addEventListener('click', () => {
  engine.setNodeState('cache', 'failed')
})

recoverBtn.addEventListener('click', () => {
  engine.setNodeState('cache', 'recovering')
  if (lastSnap) {
    const db = lastSnap.nodes.find(n => n.id === 'db')!
    if (db.state === 'failed' || db.state === 'degraded') {
      engine.setNodeState('db', 'recovering')
    }
  }
})

// ── LB buttons ──
killLbBtn.addEventListener('click', () => {
  engine.setNodeState('lb', 'failed')
})

recoverLbBtn.addEventListener('click', () => {
  engine.setNodeState('lb', 'recovering')
})

// ── App server buttons ──
killAppABtn.addEventListener('click', () => {
  engine.setNodeState('appA', 'failed')
})

killAppBBtn.addEventListener('click', () => {
  engine.setNodeState('appB', 'failed')
})

recoverAppsBtn.addEventListener('click', () => {
  if (lastSnap) {
    for (const id of ['appA', 'appB'] as const) {
      const n = lastSnap.nodes.find(n => n.id === id)!
      if (n.state === 'failed' || n.state === 'degraded') {
        engine.setNodeState(id, 'recovering')
      }
    }
  }
})

// ── Load slider ──
loadSlider.addEventListener('input', () => {
  const v = Number(loadSlider.value)
  loadValue.textContent = String(v)
  engine.setBaseLoad(v)
})

// ── Timeline ──
function goPaused(): void {
  if (paused) return
  paused = true
  engine.pause()
  playPauseBtn.textContent = '▶'
  playPauseBtn.setAttribute('aria-label', 'Resume simulation')
}

function goLive(): void {
  paused = false
  engine.resume()
  playPauseBtn.textContent = '⏸'
  playPauseBtn.setAttribute('aria-label', 'Pause simulation')
  timelineTime.textContent = 'live'
  if (lastSnap) {
    renderer.render(lastSnap)
    updateButtons(lastSnap)
  }
}

playPauseBtn.addEventListener('click', () => {
  if (paused) goLive(); else goPaused()
})

timelineSlider.addEventListener('mousedown', () => {
  if (!paused) goPaused()
})

timelineSlider.addEventListener('touchstart', () => {
  if (!paused) goPaused()
}, { passive: true })

timelineSlider.addEventListener('input', () => {
  const idx    = Number(timelineSlider.value)
  const snap   = engine.getHistoryAt(idx)
  if (!snap) return
  renderer.renderGraph(snap)
  updateButtons(snap)
  const ticksFromEnd = (engine.historyLength - 1) - idx
  timelineTime.textContent = ticksFromEnd === 0
    ? 'live'
    : `-${(ticksFromEnd / 10).toFixed(1)}s`
})

// ── Button state helpers ──
function setBtn(killEl: HTMLButtonElement, recoverEl: HTMLButtonElement, isDown: boolean): void {
  killEl.disabled    = isDown
  recoverEl.disabled = !isDown
  killEl.setAttribute('aria-disabled',    String(isDown))
  recoverEl.setAttribute('aria-disabled', String(!isDown))
}

function updateButtons(snap: Snapshot): void {
  const byId = new Map(snap.nodes.map(n => [n.id as string, n]))

  const isDown = (id: string) => {
    const s = byId.get(id)!.state
    return s === 'failed' || s === 'recovering'
  }

  setBtn(killBtn,   recoverBtn,   isDown('cache'))
  setBtn(killLbBtn, recoverLbBtn, isDown('lb'))

  const appADown = isDown('appA')
  const appBDown = isDown('appB')
  killAppABtn.disabled = appADown
  killAppABtn.setAttribute('aria-disabled', String(appADown))
  killAppBBtn.disabled = appBDown
  killAppBBtn.setAttribute('aria-disabled', String(appBDown))
  const anyAppDown = appADown || appBDown
  recoverAppsBtn.disabled = !anyAppDown
  recoverAppsBtn.setAttribute('aria-disabled', String(!anyAppDown))
}

engine.start()
