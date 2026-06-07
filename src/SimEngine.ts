import { TICK_DURATION, BASE_LOAD, CACHE_HIT_RATE_HEALTHY, CAPACITY, BASE_LAT } from './constants.js'

export type NodeState = 'healthy' | 'degraded' | 'failed' | 'recovering'
export type NodeId = 'lb' | 'appA' | 'appB' | 'cache' | 'db'
export const NODE_IDS: NodeId[] = ['lb', 'appA', 'appB', 'cache', 'db']

export interface NodeSnapshot {
  id: NodeId
  state: NodeState
  throughput: number   // effectiveThroughput forwarded downstream
  p99Latency: number
  errorRate: number
  queueDepth: number
  incomingLoad: number
}

export interface Snapshot {
  tick: number
  nodes: NodeSnapshot[]
}

interface NodeData {
  id: NodeId
  state: NodeState
  queueDepth: number
  incomingLoad: number
  effectiveThroughput: number
  errorRate: number
  p99Latency: number
  degradedTicks: number  // consecutive ticks queueDepth > 0.8*capacity (DB only)
  recoveryTicks: number  // ticks spent in 'recovering' state
}

// What the node forwards to downstream nodes.
// Capped at capacity so downstream never gets more than we can handle.
function computeEffectiveThroughput(state: NodeState, incomingLoad: number, capacity: number): number {
  switch (state) {
    case 'failed':    return 0
    case 'degraded':  return incomingLoad * 0.3
    case 'recovering':
    case 'healthy':   return Math.min(incomingLoad, capacity)
  }
}

// Queue pressure formula: service rate is capacity for healthy/recovering nodes.
// This allows the queue to DRAIN when incomingLoad < capacity (negative queueDelta).
// For degraded: service rate is the reduced effectiveThroughput.
function computeQueueDelta(state: NodeState, incomingLoad: number, effectiveThroughput: number, capacity: number): number {
  if (state === 'failed') return 0
  if (state === 'degraded') return (incomingLoad - effectiveThroughput) * TICK_DURATION
  // healthy/recovering: service at full capacity regardless of incoming
  // Fill: (1000 - 400) * 0.1 = 60/tick
  // Drain: (100 - 400) * 0.1 = -30/tick
  return (incomingLoad - capacity) * TICK_DURATION
}

function computeErrorRate(state: NodeState, queueDepth: number, capacity: number): number {
  switch (state) {
    case 'failed':    return 1.0
    case 'degraded':  return 0.2 + (queueDepth / capacity) * 0.6
    case 'recovering':
    case 'healthy':   return 0.0
  }
}

function computeP99(state: NodeState, queueDepth: number, capacity: number, baseLat: number): number {
  switch (state) {
    case 'failed':
    case 'recovering': return baseLat
    default:           return baseLat * (1 + queueDepth / capacity)
  }
}

export class SimEngine {
  private nodes = new Map<NodeId, NodeData>()
  private tickCount = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private prevDbErrorRate = 0
  private prevDbP99 = BASE_LAT['db']
  private onTickCb: (snapshot: Snapshot) => void
  private baseLoad = BASE_LOAD
  private historyBuffer: Snapshot[] = []
  private readonly MAX_HISTORY = 600

  constructor(onTick: (snapshot: Snapshot) => void) {
    this.onTickCb = onTick
    for (const id of NODE_IDS) {
      this.nodes.set(id, {
        id,
        state: 'healthy',
        queueDepth: 0,
        incomingLoad: 0,
        effectiveThroughput: 0,
        errorRate: 0,
        p99Latency: BASE_LAT[id],
        degradedTicks: 0,
        recoveryTicks: 0,
      })
    }
  }

  start(): void {
    if (this.intervalId !== null) return
    this.intervalId = setInterval(() => this.tick(), 100)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  pause(): void { this.stop() }
  resume(): void { this.start() }
  isPlaying(): boolean { return this.intervalId !== null }

  get historyLength(): number { return this.historyBuffer.length }

  getHistoryAt(index: number): Snapshot | undefined {
    return this.historyBuffer[index]
  }

  setBaseLoad(n: number): void {
    this.baseLoad = n
  }

  setNodeState(nodeId: string, state: NodeState): void {
    const node = this.nodes.get(nodeId as NodeId)
    if (!node) throw new Error(`Unknown node: ${nodeId}`)
    node.state = state
    if (state === 'recovering') {
      node.recoveryTicks = 0
      node.degradedTicks = 0
    }
    if (state === 'failed') {
      node.degradedTicks = 0
    }
  }

  tick(): void {
    const lb    = this.nodes.get('lb')!
    const appA  = this.nodes.get('appA')!
    const appB  = this.nodes.get('appB')!
    const cache = this.nodes.get('cache')!
    const db    = this.nodes.get('db')!

    const cacheMissRate = cache.state === 'failed' ? 1.0 : (1 - CACHE_HIT_RATE_HEALTHY)

    // Topological order: each node's incomingLoad set from upstream effectiveThroughput (same tick)
    this.processNode(lb, this.baseLoad, CAPACITY['lb'], BASE_LAT['lb'])

    // Smart split: route away from failed app servers
    const appADown = appA.state === 'failed'
    const appBDown = appB.state === 'failed'
    const splitA = appADown ? 0 : (appBDown ? 1 : 0.5)
    const splitB = appBDown ? 0 : (appADown ? 1 : 0.5)
    this.processAppServer(appA, lb.effectiveThroughput * splitA, CAPACITY['appA'])
    this.processAppServer(appB, lb.effectiveThroughput * splitB, CAPACITY['appB'])

    const totalAppET = appA.effectiveThroughput + appB.effectiveThroughput
    this.processNode(cache, totalAppET, CAPACITY['cache'], BASE_LAT['cache'])
    this.processNode(db, totalAppET * cacheMissRate, CAPACITY['db'], BASE_LAT['db'])

    // DB auto-transitions (DB only in v1)
    this.handleDbAutoTransitions(db)

    // Recovery auto-transition: all nodes
    for (const node of this.nodes.values()) {
      if (node.state === 'recovering') {
        node.recoveryTicks++
        if (node.recoveryTicks >= 300) {
          node.state = 'healthy'
          node.recoveryTicks = 0
        }
      }
    }

    // App servers inherit DB metrics with 1-tick lag
    const prevDbError = this.prevDbErrorRate
    const prevDbP99   = this.prevDbP99
    appA.errorRate   = prevDbError
    appA.p99Latency  = BASE_LAT['appA'] + prevDbP99
    appB.errorRate   = prevDbError
    appB.p99Latency  = BASE_LAT['appB'] + prevDbP99

    this.prevDbErrorRate = db.errorRate
    this.prevDbP99       = db.p99Latency

    this.tickCount++
    const snap = this.makeSnapshot()
    this.historyBuffer.push(snap)
    if (this.historyBuffer.length > this.MAX_HISTORY) this.historyBuffer.shift()
    this.onTickCb(snap)
  }

  private processNode(node: NodeData, incomingLoad: number, capacity: number, baseLat: number): void {
    node.incomingLoad = incomingLoad
    node.effectiveThroughput = computeEffectiveThroughput(node.state, incomingLoad, capacity)
    const queueDelta = computeQueueDelta(node.state, incomingLoad, node.effectiveThroughput, capacity)
    node.queueDepth = Math.max(0, Math.min(capacity, node.queueDepth + queueDelta))
    node.errorRate  = computeErrorRate(node.state, node.queueDepth, capacity)
    node.p99Latency = computeP99(node.state, node.queueDepth, capacity, baseLat)
  }

  private processAppServer(node: NodeData, incomingLoad: number, capacity: number): void {
    // App servers in v1: queueDepth always 0; errorRate/p99 come from DB (set after this)
    node.incomingLoad = incomingLoad
    node.effectiveThroughput = computeEffectiveThroughput(node.state, incomingLoad, capacity)
    node.queueDepth = 0
    // errorRate and p99Latency set later in tick() from prevDb
  }

  private handleDbAutoTransitions(db: NodeData): void {
    const capacity = CAPACITY['db']
    if (db.state === 'healthy') {
      if (db.queueDepth > 0.8 * capacity) {
        db.degradedTicks++
        if (db.degradedTicks >= 5) {
          db.state = 'degraded'
          db.degradedTicks = 0
        }
      } else {
        db.degradedTicks = 0
      }
    } else if (db.state === 'degraded') {
      if (db.queueDepth >= capacity) {
        db.state = 'failed'
        db.degradedTicks = 0
      }
    }
  }

  private makeSnapshot(): Snapshot {
    const nodes: NodeSnapshot[] = []
    for (const node of this.nodes.values()) {
      nodes.push({
        id:           node.id,
        state:        node.state,
        throughput:   node.effectiveThroughput,
        p99Latency:   node.p99Latency,
        errorRate:    node.errorRate,
        queueDepth:   node.queueDepth,
        incomingLoad: node.incomingLoad,
      })
    }
    return { tick: this.tickCount, nodes }
  }
}
