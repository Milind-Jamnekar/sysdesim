import * as d3 from 'd3'
import type { Snapshot, NodeId } from './SimEngine.js'

const RING_BUFFER_SIZE = 600
const NODE_RADIUS = 36
const ARROW_OFFSET = NODE_RADIUS + 4 // px from circle center to arrowhead tip

const CHART_NODES: NodeId[] = ['appA', 'appB', 'cache', 'db']

const STATE_COLORS: Record<string, string> = {
  healthy:    '#22c55e',
  degraded:   '#f59e0b',
  failed:     '#ef4444',
  recovering: '#60a5fa',
}

const CHART_COLORS: Record<string, string> = {
  appA:  '#818cf8',
  appB:  '#a78bfa',
  cache: '#34d399',
  db:    '#f97316',
}

const NODE_POS: Record<NodeId, [number, number]> = {
  lb:    [150, 70],
  appA:  [75,  175],
  appB:  [225, 175],
  cache: [150, 270],
  db:    [150, 365],
}

const EDGES: [NodeId, NodeId][] = [
  ['lb', 'appA'], ['lb', 'appB'],
  ['appA', 'cache'], ['appB', 'cache'],
  ['cache', 'db'],
]

// Normalize edge load by destination capacity so the edge goes "full" when the
// destination is at its limit. Two app servers share the cache, so each is
// measured against half the cache capacity.
const EDGE_CAP: Record<string, number> = {
  appA: 2000, appB: 2000, cache: 1500, db: 400,
}

function edgeLoad(byId: Map<string, import('./SimEngine.js').NodeSnapshot>, from: NodeId, to: NodeId): number {
  if (to === 'appA' || to === 'appB') return byId.get(to)!.incomingLoad
  if (to === 'cache') return byId.get(from)!.throughput
  if (to === 'db')    return byId.get('db')!.incomingLoad
  return 0
}

function edgeStrokeWidth(load: number, destCap: number): number {
  return 1 + Math.min(load / destCap, 1) * 5
}

interface HistoryEntry { throughput: number; p99Latency: number; errorRate: number }

type ChartDef = { key: keyof HistoryEntry; label: string; unit: string; maxY: number | null }

const CHART_DEFS: ChartDef[] = [
  { key: 'throughput', label: 'Throughput',  unit: 'req/s', maxY: null },
  { key: 'p99Latency', label: 'p99 Latency', unit: 'ms',    maxY: null },
  { key: 'errorRate',  label: 'Error Rate',  unit: '%',     maxY: 1.0  },
]

function offsetPoint(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  dist: number,
): [number, number] {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  return [x2 - (dx / len) * dist, y2 - (dy / len) * dist]
}

export class D3Renderer {
  private history = new Map<string, HistoryEntry[]>()
  private graphSvg: d3.Selection<SVGSVGElement, unknown, null, undefined>
  private chartContainers: d3.Selection<SVGSVGElement, unknown, null, undefined>[] = []

  constructor(
    graphEl: HTMLElement,
    chartsEl: HTMLElement,
  ) {
    for (const id of CHART_NODES) this.history.set(id, [])

    this.graphSvg = this.buildGraphSvg(graphEl)
    this.buildCharts(chartsEl)
  }

  renderGraph(snap: Snapshot): void {
    const byId = new Map(snap.nodes.map(n => [n.id as string, n]))
    this.graphSvg.selectAll<SVGCircleElement, NodeId>('.node-circle')
      .attr('fill', id => STATE_COLORS[byId.get(id)!.state])
    this.graphSvg.selectAll<SVGTextElement, NodeId>('.node-queue')
      .text(id => {
        const n = byId.get(id)!
        const cap = id === 'lb' ? 5000 : (id === 'appA' || id === 'appB' ? 2000 : id === 'cache' ? 3000 : 400)
        return `${Math.round((n.queueDepth / cap) * 100)}%`
      })
    for (const [from, to] of EDGES) {
      const load = edgeLoad(byId, from, to)
      const sw   = edgeStrokeWidth(load, EDGE_CAP[to])
      this.graphSvg.select(`.edge-${from}-${to}`)
        .attr('stroke-width', sw)
    }
  }

  render(snap: Snapshot): void {
    this.renderGraph(snap)

    const byId = new Map(snap.nodes.map(n => [n.id as string, n]))

    // Append to ring buffer
    for (const id of CHART_NODES) {
      const n = byId.get(id)!
      const hist = this.history.get(id)!
      hist.push({ throughput: n.throughput, p99Latency: n.p99Latency, errorRate: n.errorRate })
      if (hist.length > RING_BUFFER_SIZE) hist.shift()
    }

    // Redraw chart lines
    this.chartContainers.forEach((svg, ci) => {
      const def = CHART_DEFS[ci]
      const width  = (svg.node()!.parentElement?.clientWidth ?? 560) - 50
      const height = (svg.node()!.parentElement?.clientHeight ?? 140) - 40

      if (width < 1 || height < 1) return

      const maxLen = Math.max(...CHART_NODES.map(id => this.history.get(id)!.length))
      const xScale = d3.scaleLinear().domain([0, RING_BUFFER_SIZE]).range([0, width])
      const allVals = CHART_NODES.flatMap(id => this.history.get(id)!.map(h => h[def.key]))
      const rawMax = d3.max(allVals) ?? 0
      const yMax = def.maxY !== null ? def.maxY : Math.max(rawMax * 1.2, 10)
      const yScale = d3.scaleLinear().domain([0, yMax]).range([height, 0])

      svg.attr('width', width + 50).attr('height', height + 40)

      // Update axes
      svg.select<SVGGElement>('.x-axis')
        .attr('transform', `translate(40,${height + 5})`)
        .call(d3.axisBottom(xScale).ticks(4).tickFormat(() => ''))

      svg.select<SVGGElement>('.y-axis')
        .attr('transform', 'translate(40,5)')
        .call(d3.axisLeft(yScale).ticks(3).tickFormat(v => {
          const n = v as number
          if (def.key === 'errorRate') return `${Math.round(n * 100)}%`
          if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
          return `${Math.round(n)}`
        }))

      // Draw/update chart lines
      for (const id of CHART_NODES) {
        const hist = this.history.get(id)!
        if (hist.length < 2) continue

        const offset = RING_BUFFER_SIZE - hist.length
        const lineGen = d3.line<HistoryEntry>()
          .x((_, i) => xScale(offset + i))
          .y(d => yScale(Math.min(d[def.key], yMax)) + 5)
          .defined(d => isFinite(d[def.key]))

        svg.select<SVGPathElement>(`.line-${id}-${ci}`)
          .datum(hist)
          .attr('d', lineGen)
      }
    })
  }

  private buildGraphSvg(container: HTMLElement): d3.Selection<SVGSVGElement, unknown, null, undefined> {
    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', '0 0 300 420')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('height', '100%')
      .style('overflow', 'visible')

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('markerWidth', 8).attr('markerHeight', 6)
      .attr('refX', 8).attr('refY', 3)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', '0 0, 8 3, 0 6')
      .attr('fill', '#334155')

    // Edges
    for (const [fromId, toId] of EDGES) {
      const from = NODE_POS[fromId]
      const to   = NODE_POS[toId]
      const [x1, y1] = offsetPoint(to, from, ARROW_OFFSET)
      const [x2, y2] = offsetPoint(from, to,  ARROW_OFFSET)
      svg.append('line')
        .attr('class', `edge edge-${fromId}-${toId}`)
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', '#334155')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#arrow)')
    }

    // Nodes
    const nodeGroup = svg.selectAll('.node')
      .data(Object.keys(NODE_POS) as NodeId[])
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', id => `translate(${NODE_POS[id][0]},${NODE_POS[id][1]})`)

    nodeGroup.append('circle')
      .attr('class', 'node-circle')
      .attr('r', NODE_RADIUS)
      .attr('fill', '#22c55e')
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 3)

    nodeGroup.append('text')
      .attr('class', 'node-queue')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#ffffff')
      .attr('font-family', "'JetBrains Mono', 'Fira Code', monospace")
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .text('0%')

    nodeGroup.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', NODE_RADIUS + 16)
      .attr('fill', '#94a3b8')
      .attr('font-family', "'Inter', sans-serif")
      .attr('font-size', '13px')
      .text(id => ({ lb: 'LB', appA: 'App A', appB: 'App B', cache: 'Cache', db: 'DB' }[id]))

    return svg
  }

  private buildCharts(container: HTMLElement): void {
    for (let ci = 0; ci < CHART_DEFS.length; ci++) {
      const def = CHART_DEFS[ci]

      const wrapper = document.createElement('div')
      wrapper.className = 'chart-wrapper'
      container.appendChild(wrapper)

      // Chart title
      const title = document.createElement('div')
      title.className = 'chart-title'
      title.textContent = `${def.label} (${def.unit})`
      wrapper.appendChild(title)

      const svgContainer = document.createElement('div')
      svgContainer.className = 'chart-svg-container'
      wrapper.appendChild(svgContainer)

      const svg = d3.select(svgContainer)
        .append('svg')
        .style('display', 'block')

      svg.append('g').attr('class', 'x-axis')
      svg.append('g').attr('class', 'y-axis')

      for (const id of CHART_NODES) {
        svg.append('path')
          .attr('class', `line-${id}-${ci}`)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[id])
          .attr('stroke-width', 1.5)
          .attr('transform', 'translate(40,5)')
      }

      // Legend
      const legend = document.createElement('div')
      legend.className = 'chart-legend'
      for (const id of CHART_NODES) {
        const item = document.createElement('span')
        item.className = 'legend-item'
        const labels: Record<string, string> = { appA: 'App A', appB: 'App B', cache: 'Cache', db: 'DB' }
        item.innerHTML = `<span class="legend-dot" style="background:${CHART_COLORS[id]}"></span>${labels[id]}`
        legend.appendChild(item)
      }
      wrapper.appendChild(legend)

      this.chartContainers.push(svg)
    }
  }
}
