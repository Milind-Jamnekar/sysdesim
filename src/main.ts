import { SimEngine, type Snapshot } from './SimEngine.js'
import { D3Renderer } from './D3Renderer.js'

let lastSnap: Snapshot | null = null

const engine = new SimEngine((snap) => {
  lastSnap = snap
  renderer.render(snap)
  updateButtons(snap)
})

const graphEl    = document.getElementById('graph')!
const chartsEl   = document.getElementById('charts')!
const killBtn    = document.getElementById('btn-kill')    as HTMLButtonElement
const recoverBtn = document.getElementById('btn-recover') as HTMLButtonElement
const loadSlider = document.getElementById('load-slider') as HTMLInputElement
const loadValue  = document.getElementById('load-value')!

const renderer = new D3Renderer(graphEl, chartsEl)

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

loadSlider.addEventListener('input', () => {
  const v = Number(loadSlider.value)
  loadValue.textContent = String(v)
  engine.setBaseLoad(v)
})

function updateButtons(snap: Snapshot): void {
  const cache = snap.nodes.find(n => n.id === 'cache')!
  const isCacheDown = cache.state === 'failed' || cache.state === 'recovering'
  killBtn.disabled    = isCacheDown
  recoverBtn.disabled = !isCacheDown
  killBtn.setAttribute('aria-disabled',    String(isCacheDown))
  recoverBtn.setAttribute('aria-disabled', String(!isCacheDown))
}

engine.start()
