import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject, type GraphicsObject, type Line } from "graphics-debug"
import type { GlobalDrcForceImproveSolverParams, HighDensityRoute, SimpleRouteJson } from "../../lib"

export type MidiStageInput = Omit<GlobalDrcForceImproveSolverParams, "connMap"> & {
  netMap: Record<string, string[]>
  idToNetMap: Record<string, string>
}
type Bounds = SimpleRouteJson["bounds"]
type WirePoint = HighDensityRoute["route"][number] & { traceThickness?: number }
type Wire = {
  a: WirePoint
  b: WirePoint
  width: number
}

export const getPhysicalPeerPairs = (
  routes: HighDensityRoute[],
  connMap: ConnectivityMap,
): string[] => {
  const wires = routes.map((route): Wire[] => (route.route as WirePoint[]).flatMap((a, index) => {
    const b = (route.route as WirePoint[])[index + 1]
    if (!b || a.z !== b.z || a.toNextSegmentType === "through_obstacle") return []
    return [{ a, b, width: Math.max(a.traceThickness ?? route.traceThickness, b.traceThickness ?? route.traceThickness) }]
  }))
  const contacts = new Set<string>()
  for (let left = 0; left < routes.length; left++) {
    for (let right = left + 1; right < routes.length; right++) {
      const first = routes[left]!, second = routes[right]!
      if (connMap.areIdsConnected(first.connectionName, second.connectionName)) continue
      let overlaps = false
      for (const a of wires[left]!) {
        for (const b of wires[right]!) {
          if (a.a.z !== b.a.z) continue
          const copperRadius = (a.width + b.width) / 2
          if (Math.min(a.a.x, a.b.x) > Math.max(b.a.x, b.b.x) + copperRadius ||
            Math.max(a.a.x, a.b.x) < Math.min(b.a.x, b.b.x) - copperRadius ||
            Math.min(a.a.y, a.b.y) > Math.max(b.a.y, b.b.y) + copperRadius ||
            Math.max(a.a.y, a.b.y) < Math.min(b.a.y, b.b.y) - copperRadius) continue
          if (segmentToSegmentMinDistance(a.a, a.b, b.a, b.b) < copperRadius - 1e-6) {
            overlaps = true
            break
          }
        }
        if (overlaps) break
      }
      if (overlaps) contacts.add(JSON.stringify([first.connectionName, second.connectionName].sort()))
    }
  }
  return [...contacts].sort()
}

const clipWire = (a: Wire["a"], b: Wire["b"], bounds: Bounds): Array<{ x: number; y: number }> | undefined => {
  const dx = b.x - a.x, dy = b.y - a.y
  let start = 0, end = 1
  for (const [p, q] of [[-dx, a.x - bounds.minX], [dx, bounds.maxX - a.x], [-dy, a.y - bounds.minY], [dy, bounds.maxY - a.y]]) {
    if (p === 0 && q! < 0) return undefined
    if (p! < 0) start = Math.max(start, q! / p!)
    if (p! > 0) end = Math.min(end, q! / p!)
    if (start > end) return undefined
  }
  return [{ x: a.x + start * dx, y: a.y + start * dy }, { x: a.x + end * dx, y: a.y + end * dy }]
}

const createPanel = (srj: SimpleRouteJson, routes: HighDensityRoute[], bounds: Bounds): GraphicsObject => {
  const graphics: GraphicsObject = { coordinateSystem: "cartesian", lines: [], rects: [], circles: [], points: [] }
  graphics.rects!.push({ center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, fill: "transparent", stroke: "#cbd5e1" })
  for (const pad of srj.obstacles) {
    if (pad.center.x + pad.width / 2 < bounds.minX || pad.center.x - pad.width / 2 > bounds.maxX || pad.center.y + pad.height / 2 < bounds.minY || pad.center.y - pad.height / 2 > bounds.maxY) continue
    graphics.rects!.push({ center: pad.center, width: pad.width, height: pad.height, fill: "rgba(100,116,139,0.2)", stroke: "#94a3b8" })
  }
  for (const trace of srj.traces ?? []) {
    for (let index = 0; index < trace.route.length - 1; index++) {
      const a = trace.route[index]!, b = trace.route[index + 1]!
      if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
      const z = a.layer === "top" ? 0 : 1
      const points = clipWire({ x: a.x, y: a.y, z }, { x: b.x, y: b.y, z }, bounds)
      if (points) graphics.lines!.push({ points, strokeWidth: a.width, strokeColor: "rgba(13,148,136,0.35)", strokeDash: z === 0 ? undefined : [0.08, 0.08], label: `preloaded ${trace.connection_name}` })
    }
  }
  for (const route of routes) {
    const color = route.connectionName === "source_net_46" ? "#dc2626" : route.connectionName === "source_net_24" ? "#2563eb" : "#64748b"
    let currentLine: Line | undefined
    for (let index = 0; index < route.route.length - 1; index++) {
      const a = route.route[index]! as WirePoint, b = route.route[index + 1]! as WirePoint
      if (a.z !== b.z) {
        currentLine = undefined
        continue
      }
      const points = clipWire(a, b, bounds)
      if (!points) {
        currentLine = undefined
        continue
      }
      const width = a.traceThickness ?? route.traceThickness
      const previous = currentLine?.points.at(-1)
      if (currentLine && previous && currentLine.strokeWidth === width && Math.abs(previous.x - points[0]!.x) < 1e-9 && Math.abs(previous.y - points[0]!.y) < 1e-9) {
        currentLine.points.push(points[1]!)
      } else {
        currentLine = { points, strokeWidth: width, strokeColor: color, strokeDash: a.z === 0 ? undefined : [0.08, 0.08], label: route.connectionName }
        graphics.lines!.push(currentLine)
      }
    }
    for (const via of route.vias) {
      if (via.x < bounds.minX || via.x > bounds.maxX || via.y < bounds.minY || via.y > bounds.maxY) continue
      graphics.circles!.push({ center: via, radius: route.viaDiameter / 2, fill: color, stroke: color })
    }
  }
  return graphics
}

export const getPeerTraceSnapshotSvg = ({ srj, routes, drcCount, newPairCount }: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcCount: number
  newPairCount: number
}): string => {
  const focus = { minX: -28.5, maxX: -23, minY: 13.5, maxY: 18.5 }
  const overview = getSvgFromGraphicsObject(createPanel(srj, routes, srj.bounds), {
    backgroundColor: "white", svgWidth: 640, svgHeight: 580,
  }).replace("<svg ", '<svg x="0" y="100" ')
  const detail = getSvgFromGraphicsObject(createPanel(srj, routes, focus), {
    backgroundColor: "white", svgWidth: 640, svgHeight: 580,
  }).replace("<svg ", '<svg x="640" y="100" ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="700" viewBox="0 0 1280 700"><rect width="1280" height="700" fill="white"/><rect x="12" y="12" width="510" height="44" rx="6" fill="white" stroke="#334155"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="19" fill="#334155">Repair DRC: ${drcCount} · New physical peer pairs: ${newPairCount}</text><text x="24" y="84" font-family="Arial, sans-serif" font-size="20">Routed MIDI stage</text><text x="664" y="84" font-family="Arial, sans-serif" font-size="20">Connector escape: net46 red / net24 blue</text>${overview}${detail}</svg>`.replace(/[ \t]+$/gm, "")
}
