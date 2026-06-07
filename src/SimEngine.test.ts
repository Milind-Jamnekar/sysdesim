import { describe, it, expect, beforeEach } from 'vitest'
import { SimEngine } from './SimEngine.js'
import { CAPACITY, BASE_LAT, BASE_LOAD, TICK_DURATION, CACHE_HIT_RATE_HEALTHY } from './constants.js'

function node(snap: ReturnType<InstanceType<typeof SimEngine>['tick'] extends (...args: any) => any ? never : any> | any, id: string) {
  return snap.nodes.find((n: any) => n.id === id)!
}

function makeEngine() {
  let snap: any
  const engine = new SimEngine((s) => { snap = s })
  return { engine, getSnap: () => snap }
}

describe('SimEngine', () => {
  // ===== T1: Init =====
  it('T1: all 5 nodes start healthy; db.incomingLoad≈100; all queues=0', () => {
    const { engine, getSnap } = makeEngine()
    engine.tick()
    const s = getSnap()
    expect(node(s, 'lb').state).toBe('healthy')
    expect(node(s, 'appA').state).toBe('healthy')
    expect(node(s, 'appB').state).toBe('healthy')
    expect(node(s, 'cache').state).toBe('healthy')
    expect(node(s, 'db').state).toBe('healthy')
    expect(node(s, 'db').incomingLoad).toBeCloseTo(BASE_LOAD * (1 - CACHE_HIT_RATE_HEALTHY), 1)
    expect(node(s, 'db').queueDepth).toBe(0)
    expect(node(s, 'lb').queueDepth).toBe(0)
  })

  // ===== T2-T5: effectiveThroughput =====
  it('T2: effectiveThroughput failed → 0', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').throughput).toBe(0)
  })

  it('T3: effectiveThroughput degraded → incomingLoad * 0.3', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'degraded')
    engine.tick()
    const db = node(getSnap(), 'db')
    expect(db.throughput).toBeCloseTo(db.incomingLoad * 0.3, 5)
  })

  it('T4: effectiveThroughput recovering → min(incomingLoad, capacity)', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'recovering')
    engine.tick()
    const db = node(getSnap(), 'db')
    expect(db.throughput).toBe(Math.min(db.incomingLoad, CAPACITY['db']))
  })

  it('T5: effectiveThroughput healthy → min(incomingLoad, capacity)', () => {
    const { engine, getSnap } = makeEngine()
    engine.tick()
    const db = node(getSnap(), 'db')
    expect(db.throughput).toBeCloseTo(Math.min(db.incomingLoad, CAPACITY['db']), 1)
  })

  // ===== T6: queueDelta for failed =====
  it('T6: failed node queueDelta=0 regardless of incomingLoad', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBe(0)
    engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBe(0)
  })

  // ===== T7-T8: queueDepth fills and drains =====
  it('T7: queueDepth fills at (1000-400)*0.1=60 per tick when db load=1000', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBeCloseTo(60, 1)
  })

  it('T8: queueDepth drains when incomingLoad drops below capacity', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    for (let i = 0; i < 5; i++) engine.tick()
    const qAfterFill = node(getSnap(), 'db').queueDepth
    expect(qAfterFill).toBeGreaterThan(0)

    engine.setNodeState('cache', 'recovering')
    engine.setNodeState('db', 'recovering')
    engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBeLessThan(qAfterFill)
  })

  // ===== T9-T10: queueDepth clamps =====
  it('T9: queueDepth never goes below 0', () => {
    const { engine, getSnap } = makeEngine()
    // All healthy, db load ≈ 100 < capacity 400: queueDelta = (100-400)*0.1 = -30, but clamped
    engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBe(0)
  })

  it('T10: queueDepth clamps at capacity', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    // Each tick fills 60. After 7 ticks: 420 → clamped to 400
    for (let i = 0; i < 8; i++) engine.tick()
    expect(node(getSnap(), 'db').queueDepth).toBeLessThanOrEqual(CAPACITY['db'])
    expect(node(getSnap(), 'db').queueDepth).toBe(CAPACITY['db'])
  })

  // ===== T11-T14: errorRate =====
  it('T11: errorRate failed → 1.0', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').errorRate).toBe(1.0)
  })

  it('T12: errorRate degraded → 0.2 + (queueDepth/capacity)*0.6', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'degraded')
    engine.tick()
    const db = node(getSnap(), 'db')
    const expected = 0.2 + (db.queueDepth / CAPACITY['db']) * 0.6
    expect(db.errorRate).toBeCloseTo(expected, 5)
  })

  it('T13: errorRate recovering → 0.0', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'recovering')
    engine.tick()
    expect(node(getSnap(), 'db').errorRate).toBe(0.0)
  })

  it('T14: errorRate healthy → 0.0', () => {
    const { engine, getSnap } = makeEngine()
    engine.tick()
    expect(node(getSnap(), 'db').errorRate).toBe(0.0)
  })

  // ===== T15-T17: p99Latency =====
  it('T15: p99 failed → baseLat', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').p99Latency).toBe(BASE_LAT['db'])
  })

  it('T16: p99 recovering → baseLat', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'recovering')
    engine.tick()
    expect(node(getSnap(), 'db').p99Latency).toBe(BASE_LAT['db'])
  })

  it('T17: p99 healthy with queue → baseLat * (1 + queueDepth/capacity)', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.tick() // queueDepth = 60
    const db = node(getSnap(), 'db')
    const expected = BASE_LAT['db'] * (1 + db.queueDepth / CAPACITY['db'])
    expect(db.p99Latency).toBeCloseTo(expected, 5)
  })

  // ===== T18-T19: auto-transition healthy→degraded =====
  it('T18: healthy→degraded fires after exactly 5 consecutive ticks above 80% queue', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    // Need queueDepth > 0.8*400 = 320. Fills at 60/tick. Exceeds 320 at tick 6 (6*60=360)
    for (let i = 0; i < 10; i++) engine.tick()
    // By tick 10, DB should have auto-transitioned to degraded
    expect(node(getSnap(), 'db').state).toBe('degraded')
  })

  it('T19: healthy→degraded does NOT fire before 5 consecutive ticks above 80%', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    // After tick 6: first tick above 80% (360 > 320). Need 5 more.
    for (let i = 0; i < 7; i++) engine.tick() // tick 7: 1st tick above 80%, degradedTicks=1
    expect(node(getSnap(), 'db').state).toBe('healthy')
  })

  // ===== T20: degraded→failed =====
  it('T20: degraded→failed when queueDepth >= capacity', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'degraded')
    // Degraded: queueDelta = (1000 - 300)*0.1 = 70/tick. Hits 400 in 6 ticks.
    for (let i = 0; i < 7; i++) engine.tick()
    expect(node(getSnap(), 'db').state).toBe('failed')
  })

  // ===== T21: recovering→healthy =====
  it('T21: recovering→healthy auto after exactly 300 ticks', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'recovering')
    for (let i = 0; i < 299; i++) engine.tick()
    expect(node(getSnap(), 'db').state).toBe('recovering')
    engine.tick() // tick 300
    expect(node(getSnap(), 'db').state).toBe('healthy')
  })

  // ===== T22: edge case — recovery timer reset =====
  it('T22: recovery timer resets if re-failed during recovery', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('db', 'recovering')
    for (let i = 0; i < 150; i++) engine.tick() // halfway through recovery
    engine.setNodeState('db', 'failed')
    engine.setNodeState('db', 'recovering') // restart recovery
    for (let i = 0; i < 299; i++) engine.tick()
    expect(node(getSnap(), 'db').state).toBe('recovering') // not done yet
    engine.tick() // tick 300 from RESET point
    expect(node(getSnap(), 'db').state).toBe('healthy')
  })

  // ===== T23-T24: app server inheritance =====
  it('T23: appA errorRate = db.errorRate[t-1]', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.setNodeState('db', 'failed')
    engine.tick() // tick 1: prevDbErrorRate=0 (tick 0), so appA.errorRate=0 this tick
    const s1 = getSnap()
    const dbError1 = node(s1, 'db').errorRate    // 1.0
    engine.tick() // tick 2: appA.errorRate should be 1.0 (from tick 1's db)
    const s2 = getSnap()
    expect(node(s2, 'appA').errorRate).toBe(dbError1)
  })

  it('T24: appA p99 = baseLat + db.p99[t-1]', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.tick() // tick 1: db p99 computed
    const dbP99tick1 = node(getSnap(), 'db').p99Latency
    engine.tick() // tick 2: appA p99 = BASE_LAT.appA + dbP99tick1
    expect(node(getSnap(), 'appA').p99Latency).toBeCloseTo(BASE_LAT['appA'] + dbP99tick1, 5)
  })

  // ===== T25-T27: routing =====
  it('T25: baseline db.incomingLoad = BASE_LOAD * (1 - CACHE_HIT_RATE_HEALTHY) ≈ 100', () => {
    const { engine, getSnap } = makeEngine()
    engine.tick()
    expect(node(getSnap(), 'db').incomingLoad).toBeCloseTo(BASE_LOAD * (1 - CACHE_HIT_RATE_HEALTHY), 1)
  })

  it('T26: kill cache → db.incomingLoad ≈ BASE_LOAD (1000)', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    engine.tick()
    expect(node(getSnap(), 'db').incomingLoad).toBeCloseTo(BASE_LOAD, 0)
  })

  it('T27: LB split: appA.incomingLoad = appB.incomingLoad = BASE_LOAD/2', () => {
    const { engine, getSnap } = makeEngine()
    engine.tick()
    const s = getSnap()
    expect(node(s, 'appA').incomingLoad).toBeCloseTo(BASE_LOAD / 2, 0)
    expect(node(s, 'appB').incomingLoad).toBeCloseTo(BASE_LOAD / 2, 0)
  })

  // ===== T28: integration — full cascade =====
  it('T28: kill cache → db degrades within 15 ticks → error rate climbs', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    for (let i = 0; i < 15; i++) engine.tick()
    const db = node(getSnap(), 'db')
    expect(['degraded', 'failed']).toContain(db.state)
    expect(db.errorRate).toBeGreaterThan(0)
  })

  // ===== T29: integration — recovery =====
  it('T29: recover cache → db.incomingLoad drops → queueDepth drains to 0', () => {
    const { engine, getSnap } = makeEngine()
    engine.setNodeState('cache', 'failed')
    for (let i = 0; i < 8; i++) engine.tick() // fill queue
    expect(node(getSnap(), 'db').queueDepth).toBeGreaterThan(0)

    engine.setNodeState('cache', 'recovering')
    engine.setNodeState('db', 'recovering')
    for (let i = 0; i < 120; i++) engine.tick() // drain
    expect(node(getSnap(), 'db').queueDepth).toBe(0)
  })

  // ===== Validation =====
  it('setNodeState with invalid nodeId throws Error', () => {
    const { engine } = makeEngine()
    expect(() => engine.setNodeState('nonexistent', 'failed')).toThrow('Unknown node: nonexistent')
  })
})
