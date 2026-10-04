import {
  doesLineIntersectLine,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { createNativeDrcCopperContactTester } from "./createNativeDrcCopperContactTester"
import {
  getNativePadClearance,
  getNativeSegmentBounds,
  NativeDrcGrid,
  pointInNativePad,
} from "./nativeDrcGeometry"
import type {
  NativeDrcBounds,
  NativeDrcError,
  NativeDrcPoint,
  NativeDrcPort,
  NativeDrcTrace,
  NativeDrcWire,
  PreparedNativeDrcEvaluation,
  PreparedNativeDrcPad,
} from "./nativeDrcTypes"

const CONTACT_EPSILON = 1e-9
const GRAPH_CONTACT_EPSILON = 1e-7

type WireSegment = {
  trace: NativeDrcTrace
  start: NativeDrcWire
  end: NativeDrcWire
  bounds: NativeDrcBounds
}
type TraceBounds = NativeDrcBounds & { traceIndex: number }
type ViaContact = NativeDrcPoint & {
  id: string
  ownerTraceId?: string
  radius?: number
  layers: string[]
  touchesPad: boolean
  touchingTraceIds: Set<string>
}
type LayerBridge = NativeDrcPoint & { layers: string[]; diameter?: number }

function getTraceName(trace: NativeDrcTrace): string {
  const portIds = trace.route.flatMap((point) =>
    point.route_type === "wire"
      ? [point.start_pcb_port_id, point.end_pcb_port_id].filter(
          (id): id is string => Boolean(id),
        )
      : [],
  )
  return portIds.length
    ? `trace[${portIds.map((id) => `port[${id}]`).join(", ")}]`
    : `trace[${trace.pcb_trace_id}]`
}

function expandBounds(
  bounds: NativeDrcBounds,
  amount: number,
): NativeDrcBounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  }
}

function getWireSegments(traces: NativeDrcTrace[]): WireSegment[] {
  const segments: WireSegment[] = []
  for (const trace of traces) {
    for (let i = 1; i < trace.route.length; i++) {
      const start = trace.route[i - 1]!
      const end = trace.route[i]!
      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      if (start.layer !== end.layer) continue
      segments.push({
        trace,
        start,
        end,
        bounds: expandBounds(
          getNativeSegmentBounds(start, end),
          start.width / 2,
        ),
      })
    }
  }
  return segments
}

function buildLayerIndexes(
  segments: WireSegment[],
): Map<string, NativeDrcGrid<WireSegment>> {
  const byLayer = new Map<string, WireSegment[]>()
  for (const segment of segments) {
    const entries = byLayer.get(segment.start.layer) ?? []
    entries.push(segment)
    byLayer.set(segment.start.layer, entries)
  }
  return new Map(
    [...byLayer].map(([layer, entries]) => [
      layer,
      new NativeDrcGrid(entries, (segment) => segment.bounds),
    ]),
  )
}

function pointTouchesPad(
  point: NativeDrcTrace["route"][number],
  pad: PreparedNativeDrcPad,
): boolean {
  return (
    point.route_type === "wire" &&
    pad.layers.includes(point.layer) &&
    pointInNativePad(point, pad)
  )
}

function getLayerSpan(from: string, to: string, layerCount: number): string[] {
  const stack = [
    "top",
    ...Array.from(
      { length: Math.max(0, layerCount - 2) },
      (_, i) => `inner${i + 1}`,
    ),
    ...(layerCount === 1 ? [] : ["bottom"]),
  ]
  const fromIndex = stack.indexOf(from)
  const toIndex = stack.indexOf(to)
  if (fromIndex < 0 || toIndex < 0) return []
  return stack.slice(
    Math.min(fromIndex, toIndex),
    Math.max(fromIndex, toIndex) + 1,
  )
}

function getLayerBridges(
  evaluation: PreparedNativeDrcEvaluation,
): LayerBridge[] {
  const bridges: LayerBridge[] = evaluation.vias.map((via) => ({
    x: via.x,
    y: via.y,
    layers: via.layers,
    diameter: via.diameter,
  }))
  for (const trace of evaluation.traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      if (
        evaluation.vias.some(
          (via) =>
            Math.hypot(via.x - point.x, via.y - point.y) <= CONTACT_EPSILON,
        )
      )
        continue
      const layers = getLayerSpan(
        point.from_layer,
        point.to_layer,
        evaluation.scene.layerCount,
      )
      if (!layers.length) continue
      // The reference wire/via projection deliberately omits route-via copper
      // diameters; separately emitted physical vias retain their diameter.
      bridges.push({ x: point.x, y: point.y, layers })
    }
  }
  return bridges
}

function getMissingConnectionCenter(
  trace: NativeDrcTrace,
  port: NativeDrcPort,
  expectedPorts: NativeDrcPort[],
  padsByPort: Map<string, PreparedNativeDrcPad[]>,
): NativeDrcPoint {
  const first = trace.route[0]!
  const last = trace.route.at(-1)!
  const firstWire = first.route_type === "wire" ? first : undefined
  const lastWire = last.route_type === "wire" ? last : undefined
  const references = (point: NativeDrcTrace["route"][number]): boolean =>
    point.route_type === "wire" &&
    [point.start_pcb_port_id, point.end_pcb_port_id].includes(port.id)
  const touchesOtherExpectedPort = (
    point: NativeDrcTrace["route"][number],
  ): boolean =>
    expectedPorts.some(
      (other) =>
        other.id !== port.id &&
        padsByPort.get(other.id)?.some((pad) => pointTouchesPad(point, pad)),
    )
  let center: NativeDrcPoint | undefined
  if (references(first) && firstWire) center = firstWire
  else if (references(last) && lastWire) center = lastWire
  else if (touchesOtherExpectedPort(first) && lastWire) center = lastWire
  else if (touchesOtherExpectedPort(last) && firstWire) center = firstWire
  else if (firstWire && lastWire)
    center =
      Math.hypot(firstWire.x - port.x, firstWire.y - port.y) <=
      Math.hypot(lastWire.x - port.x, lastWire.y - port.y)
        ? firstWire
        : lastWire
  else if (firstWire) center = firstWire
  else if (lastWire) center = lastWire
  return center
    ? { x: center.x, y: center.y }
    : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
}

/** Reference continuity rules evaluated directly on the prepared native scene. */
export function checkNativeDrcContinuity(
  evaluation: PreparedNativeDrcEvaluation,
): NativeDrcError[] {
  const { traces, pads, scene } = evaluation
  const copperContacts = createNativeDrcCopperContactTester()
  const firstTraceById = new Map<string, NativeDrcTrace>()
  for (const trace of traces) {
    if (!firstTraceById.has(trace.pcb_trace_id))
      firstTraceById.set(trace.pcb_trace_id, trace)
  }
  const traceName = (trace: NativeDrcTrace): string =>
    getTraceName(firstTraceById.get(trace.pcb_trace_id)!)
  const errors: NativeDrcError[] = []
  const portsById = new Map(scene.ports.map((port) => [port.id, port]))
  const padsByPort = new Map<string, PreparedNativeDrcPad[]>()
  for (const pad of pads) {
    if (!pad.portId) continue
    const entries = padsByPort.get(pad.portId) ?? []
    entries.push(pad)
    padsByPort.set(pad.portId, entries)
  }
  const padIndex = new NativeDrcGrid(pads, (pad) => pad.bounds)
  const bridges = getLayerBridges(evaluation)
  const layersForPort = (port: NativeDrcPort): string[] => {
    const portPads = padsByPort.get(port.id)
    return portPads?.length
      ? [...new Set(portPads.flatMap((pad) => pad.layers))]
      : port.layers
  }
  const canConnectPortLayer = (
    point: NativeDrcWire,
    portId: string,
  ): boolean => {
    const port = portsById.get(portId)
    if (!port) return true
    const layers = layersForPort(port)
    if (layers.includes(point.layer)) return true
    const portPads = padsByPort.get(portId) ?? []
    return bridges.some((via) => {
      if (
        !via.layers.includes(point.layer) ||
        !layers.some((layer) => via.layers.includes(layer))
      )
        return false
      if (
        via.diameter !== undefined &&
        (!Number.isFinite(via.diameter) || via.diameter <= 0)
      )
        return false
      const reach =
        via.diameter === undefined ? 0 : via.diameter / 2 + point.width / 2
      if (
        Math.hypot(point.x - via.x, point.y - via.y) >
        reach + CONTACT_EPSILON
      )
        return false
      if (!portPads.length)
        return Math.hypot(port.x - via.x, port.y - via.y) <= CONTACT_EPSILON
      return portPads.some(
        (pad) =>
          pad.layers.some((layer) => via.layers.includes(layer)) &&
          (via.diameter === undefined
            ? pointInNativePad(via, pad)
            : getNativePadClearance(
                { start: via, end: via, width: via.diameter },
                pad,
              ).gap <= CONTACT_EPSILON),
      )
    })
  }
  for (const trace of traces) {
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "wire") continue
      for (const portId of new Set([
        point.start_pcb_port_id,
        point.end_pcb_port_id,
      ])) {
        if (!portId || canConnectPortLayer(point, portId)) continue
        const port = portsById.get(portId)!
        const padLayers = layersForPort(port)
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_error_id: `missing_layer_connection_${trace.pcb_trace_id}_${index}_${port.id}`,
          pcb_trace_id: trace.pcb_trace_id,
          source_trace_id: trace.source_trace_id ?? `!${trace.pcb_trace_id}`,
          pcb_port_ids: [port.id],
          pcb_component_ids: port.componentId ? [port.componentId] : [],
          center: { x: point.x, y: point.y },
          message: `Trace [${traceName(trace)}] on ${point.layer} is missing a via connection to port [pcb_port[#${port.id}]] on ${padLayers.join(", ")}.`,
        })
      }
    }
  }

  // Physical connectivity and logical aliases are separate. In particular,
  // physical emitted-via ownership does not invent a logical via net.
  const traceById = new Map(traces.map((trace) => [trace.pcb_trace_id, trace]))
  const physicalTraces = [...traceById.values()]
  const logicalNet = (id: string): string | undefined => {
    const trace = traceById.get(id)
    return scene.connectivity.getNetConnectedToId(trace?.source_trace_id || id)
  }
  const rawSegments = getWireSegments(physicalTraces)
  const segmentIndexes = buildLayerIndexes(rawSegments)
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const direct = parent.get(id)
    if (direct === undefined) {
      parent.set(id, id)
      return id
    }
    if (direct === id) return id
    const root = find(direct)
    parent.set(id, root)
    return root
  }
  const join = (left: string, right: string): void => {
    parent.set(find(right), find(left))
  }
  const traceNode = (id: string): string => `trace:${id}`
  const portNode = (id: string): string => `port:${id}`
  const boundsByLayer = new Map<string, TraceBounds[]>()
  for (const [traceIndex, trace] of physicalTraces.entries()) {
    const boundsForTrace = new Map<string, TraceBounds>()
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]!
      const b = trace.route[i]!
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== b.layer
      )
        continue
      const segmentBounds = expandBounds(
        getNativeSegmentBounds(a, b),
        a.width / 2 + CONTACT_EPSILON,
      )
      const bounds = boundsForTrace.get(a.layer)
      if (bounds) {
        bounds.minX = Math.min(bounds.minX, segmentBounds.minX)
        bounds.minY = Math.min(bounds.minY, segmentBounds.minY)
        bounds.maxX = Math.max(bounds.maxX, segmentBounds.maxX)
        bounds.maxY = Math.max(bounds.maxY, segmentBounds.maxY)
      } else boundsForTrace.set(a.layer, { ...segmentBounds, traceIndex })
    }
    for (const [layer, bounds] of boundsForTrace) {
      const entries = boundsByLayer.get(layer) ?? []
      entries.push(bounds)
      boundsByLayer.set(layer, entries)
    }
  }
  const candidates = physicalTraces.map(() => new Set<number>())
  for (const bounds of boundsByLayer.values()) {
    // Whole-trace boxes can span the board. A sweep avoids inserting each
    // large box into thousands of fine geometry cells while keeping exactly
    // the same inclusive box-overlap admission as the reference packed index.
    let active: TraceBounds[] = []
    for (const box of [...bounds].sort(
      (left, right) => left.minX - right.minX,
    )) {
      active = active.filter((other) => other.maxX >= box.minX)
      for (const other of active) {
        if (other.minY > box.maxY || other.maxY < box.minY) continue
        const first = Math.min(box.traceIndex, other.traceIndex)
        const second = Math.max(box.traceIndex, other.traceIndex)
        if (first !== second) candidates[first]!.add(second)
      }
      active.push(box)
    }
  }
  for (const [i, neighbors] of candidates.entries()) {
    const left = physicalTraces[i]!
    for (const j of [...neighbors].sort((a, b) => a - b)) {
      const right = physicalTraces[j]!
      let connected = false
      // Preserve the native SDK19 predicate after its shared-layer trace-bound
      // admission: its inner wire-pair search does not add a layer filter.
      for (let a = 1; a < left.route.length && !connected; a++) {
        const a1 = left.route[a - 1]!,
          a2 = left.route[a]!
        if (a1.route_type !== "wire" || a2.route_type !== "wire") continue
        for (let b = 1; b < right.route.length; b++) {
          const b1 = right.route[b - 1]!,
            b2 = right.route[b]!
          if (b1.route_type !== "wire" || b2.route_type !== "wire") continue
          if (
            doesLineIntersectLine([a1, a2], [b1, b2], {
              lineThickness: (a1.width + b1.width) / 2,
            })
          ) {
            connected = true
            break
          }
        }
      }
      if (connected)
        join(traceNode(left.pcb_trace_id), traceNode(right.pcb_trace_id))
    }
  }
  for (const trace of physicalTraces) {
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      for (const portId of new Set([
        point.start_pcb_port_id,
        point.end_pcb_port_id,
      ])) {
        if (
          portId &&
          portsById.has(portId) &&
          canConnectPortLayer(point, portId)
        )
          join(traceNode(trace.pcb_trace_id), portNode(portId))
      }
    }
  }
  const viaGrid = new NativeDrcGrid(evaluation.vias, (via) => via.bounds)
  for (const via of evaluation.vias) {
    const viaNode = `via:${via.id}`
    if (via.traceId) join(viaNode, traceNode(via.traceId))
    for (const layer of via.layers) {
      for (const segment of segmentIndexes
        .get(layer)
        ?.query(via.bounds, GRAPH_CONTACT_EPSILON) ?? []) {
        if (
          segment.start.x === segment.end.x &&
          segment.start.y === segment.end.y
        )
          continue
        if (copperContacts.viaTouchesSegment(via, segment.start, segment.end))
          join(viaNode, traceNode(segment.trace.pcb_trace_id))
      }
    }
    for (const other of viaGrid.query(via.bounds, GRAPH_CONTACT_EPSILON)) {
      if (
        other === via ||
        !via.layers.some((layer) => other.layers.includes(layer))
      )
        continue
      if (copperContacts.viasTouch(via, other)) join(viaNode, `via:${other.id}`)
    }
  }
  const touchedPorts = new Map<string, Set<string>>()
  for (const trace of traces) {
    const touched = new Set<string>()
    for (const point of [trace.route[0], trace.route.at(-1)]) {
      if (!point || point.route_type !== "wire") continue
      for (const pad of padIndex.query(
        { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
        CONTACT_EPSILON,
      )) {
        if (pad.portId && pointTouchesPad(point, pad)) touched.add(pad.portId)
      }
    }
    touchedPorts.set(trace.pcb_trace_id, touched)
    for (const portId of touched)
      join(traceNode(trace.pcb_trace_id), portNode(portId))
  }
  const portsByPhysicalRoot = new Map<string, Set<string>>()
  for (const [traceId, touched] of touchedPorts) {
    const root = find(traceNode(traceId))
    const entries = portsByPhysicalRoot.get(root) ?? new Set<string>()
    for (const portId of touched) entries.add(portId)
    portsByPhysicalRoot.set(root, entries)
  }

  let viaContactsByNetAndLayer:
    | Map<string, Map<string, ViaContact[]>>
    | undefined
  const getViaContacts = (): Map<string, Map<string, ViaContact[]>> => {
    if (viaContactsByNetAndLayer) return viaContactsByNetAndLayer
    const index = new Map<string, Map<string, ViaContact[]>>()
    const add = (
      contact: Omit<ViaContact, "touchesPad" | "touchingTraceIds">,
    ): void => {
      if (![contact.x, contact.y].every(Number.isFinite)) return
      const net = logicalNet(contact.id)
      if (!net) return
      const bounds = expandBounds(
        { minX: contact.x, minY: contact.y, maxX: contact.x, maxY: contact.y },
        contact.radius ?? 0,
      )
      const touchesPad = padIndex.query(bounds, CONTACT_EPSILON).some((pad) => {
        if (
          logicalNet(pad.id) !== net ||
          !pad.layers.some((layer) => contact.layers.includes(layer))
        )
          return false
        return contact.radius === undefined
          ? pointInNativePad(contact, pad)
          : getNativePadClearance(
              { start: contact, end: contact, width: contact.radius * 2 },
              pad,
            ).gap <= CONTACT_EPSILON
      })
      const touchingTraceIds = new Set<string>()
      for (const layer of contact.layers) {
        for (const segment of segmentIndexes
          .get(layer)
          ?.query(bounds, CONTACT_EPSILON) ?? []) {
          if (
            logicalNet(segment.trace.pcb_trace_id) !== net ||
            !Number.isFinite(segment.start.width) ||
            segment.start.width <= 0 ||
            Math.hypot(
              segment.start.x - segment.end.x,
              segment.start.y - segment.end.y,
            ) <= CONTACT_EPSILON
          )
            continue
          const reach =
            contact.radius === undefined
              ? 0
              : contact.radius + segment.start.width / 2
          if (
            pointToSegmentDistance(contact, segment.start, segment.end) <=
            reach + CONTACT_EPSILON
          )
            touchingTraceIds.add(segment.trace.pcb_trace_id)
        }
      }
      const copper = { ...contact, touchesPad, touchingTraceIds }
      const byLayer = index.get(net) ?? new Map<string, ViaContact[]>()
      for (const layer of contact.layers) {
        const entries = byLayer.get(layer) ?? []
        entries.push(copper)
        byLayer.set(layer, entries)
      }
      index.set(net, byLayer)
    }
    for (const via of evaluation.vias) {
      if (!Number.isFinite(via.diameter) || via.diameter <= 0) continue
      add({
        id: via.id,
        x: via.x,
        y: via.y,
        ownerTraceId: via.traceId,
        radius: via.diameter / 2,
        layers: via.layers,
      })
    }
    for (const trace of traces) {
      for (const point of trace.route) {
        if (point.route_type !== "via") continue
        if (
          evaluation.vias.some(
            (via) =>
              Math.hypot(via.x - point.x, via.y - point.y) <= CONTACT_EPSILON &&
              (via.traceId === trace.pcb_trace_id ||
                (!via.traceId &&
                  scene.connectivity.areIdsConnected(
                    via.id,
                    trace.pcb_trace_id,
                  ))),
          )
        )
          continue
        const layers = getLayerSpan(
          point.from_layer,
          point.to_layer,
          scene.layerCount,
        )
        if (layers.length)
          add({
            id: trace.pcb_trace_id,
            x: point.x,
            y: point.y,
            ownerTraceId: trace.pcb_trace_id,
            layers,
          })
      }
    }
    viaContactsByNetAndLayer = index
    return index
  }
  const endpointWidth = (
    trace: NativeDrcTrace,
    endpoint: "start" | "end",
  ): number | undefined => {
    let i = endpoint === "start" ? 0 : trace.route.length - 2
    const increment = endpoint === "start" ? 1 : -1
    while (i >= 0 && i < trace.route.length - 1) {
      const a = trace.route[i]!,
        b = trace.route[i + 1]!
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== b.layer
      )
        return undefined
      if (Math.hypot(a.x - b.x, a.y - b.y) > CONTACT_EPSILON) return a.width
      i += increment
    }
    return undefined
  }
  const endpointConnected = (
    point: NativeDrcTrace["route"][number],
    trace: NativeDrcTrace,
    endpoint: "start" | "end",
  ): boolean => {
    if (point.route_type !== "wire") return false
    if (
      padIndex
        .query(
          { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
          CONTACT_EPSILON,
        )
        .some((pad) => pointTouchesPad(point, pad))
    )
      return true
    const width = endpointWidth(trace, endpoint)
    if (width === undefined) return false
    const net = logicalNet(trace.pcb_trace_id)
    if (!net) return false
    const pointBounds = {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    }
    for (const segment of segmentIndexes
      .get(point.layer)
      ?.query(pointBounds, width / 2 + CONTACT_EPSILON) ?? []) {
      if (
        segment.trace.pcb_trace_id === trace.pcb_trace_id ||
        logicalNet(segment.trace.pcb_trace_id) !== net ||
        Math.hypot(
          segment.start.x - segment.end.x,
          segment.start.y - segment.end.y,
        ) <= CONTACT_EPSILON
      )
        continue
      if (
        pointToSegmentDistance(point, segment.start, segment.end) <=
        width / 2 + segment.start.width / 2 + CONTACT_EPSILON
      )
        return true
    }
    if (!Number.isFinite(width) || width <= 0) return false
    return (getViaContacts().get(net)?.get(point.layer) ?? []).some((via) => {
      if (
        via.ownerTraceId === trace.pcb_trace_id ||
        (!via.touchesPad &&
          ![...via.touchingTraceIds].some((id) => id !== trace.pcb_trace_id))
      )
        return false
      return (
        Math.hypot(point.x - via.x, point.y - via.y) <=
        (via.radius === undefined ? 0 : via.radius + width / 2) +
          CONTACT_EPSILON
      )
    })
  }
  const sourceTracesById = new Map<
    string,
    (typeof scene.sourceTraces)[number]
  >()
  for (const source of scene.sourceTraces) {
    if (!sourceTracesById.has(source.id))
      sourceTracesById.set(source.id, source)
  }
  const checkedSourceTraceIds = new Set<string>()
  for (const trace of traces) {
    if (!trace.route.length) continue
    const first = trace.route[0]!,
      last = trace.route.at(-1)!
    const source = sourceTracesById.get(trace.source_trace_id)
    const expectedPorts = source
      ? scene.ports.filter((port) => source.portIds.includes(port.id))
      : []
    for (let i = 1; i < trace.route.length - 1; i++) {
      const previous = trace.route[i - 1]!,
        current = trace.route[i]!,
        next = trace.route[i + 1]!
      if (
        current.route_type !== "via" ||
        previous.route_type !== "wire" ||
        next.route_type !== "wire"
      )
        continue
      const previousAligned =
        Math.abs(previous.x - current.x) < 0.01 &&
        Math.abs(previous.y - current.y) < 0.01
      const nextAligned =
        Math.abs(next.x - current.x) < 0.01 &&
        Math.abs(next.y - current.y) < 0.01
      if (!previousAligned || !nextAligned)
        errors.push({
          type: "pcb_trace_error",
          message: `Via in trace [${traceName(trace)}] is misaligned at position {x: ${current.x}, y: ${current.y}}.`,
          source_trace_id:
            source?.id || trace.source_trace_id || `!${trace.pcb_trace_id}`,
          error_type: "pcb_trace_error",
          pcb_trace_id: trace.pcb_trace_id,
          pcb_trace_error_id: `misaligned_via_${trace.pcb_trace_id}_${i}`,
          pcb_component_ids: [],
          pcb_port_ids: [],
        })
    }
    if (source && expectedPorts.length) {
      if (checkedSourceTraceIds.has(source.id)) continue
      checkedSourceTraceIds.add(source.id)
    }
    for (const port of expectedPorts) {
      const portPads = padsByPort.get(port.id)
      if (!portPads?.length) continue
      if (
        portsByPhysicalRoot
          .get(find(traceNode(trace.pcb_trace_id)))
          ?.has(port.id)
      )
        continue
      if (
        portPads.some(
          (pad) => pointTouchesPad(first, pad) || pointTouchesPad(last, pad),
        )
      )
        continue
      const padType = portPads[0]!.kind === "smtpad" ? "smtpad" : "plated_hole"
      errors.push({
        type: "pcb_trace_error",
        message: `Trace [${traceName(trace)}] is missing a connection to ${padType}[#${port.id}]`,
        source_trace_id:
          source?.id || trace.source_trace_id || `!${trace.pcb_trace_id}`,
        error_type: "pcb_trace_error",
        pcb_trace_id: trace.pcb_trace_id,
        pcb_trace_error_id: `missing_connection_${trace.pcb_trace_id}_${port.id}`,
        center: getMissingConnectionCenter(
          trace,
          port,
          expectedPorts,
          padsByPort,
        ),
        pcb_component_ids: [],
        pcb_port_ids: [port.id],
      })
    }
    if (!expectedPorts.length) {
      const firstConnected = endpointConnected(first, trace, "start")
      const lastConnected = endpointConnected(last, trace, "end")
      const endpointsAreSame =
        first.route_type === "wire" &&
        last.route_type === "wire" &&
        first.layer === last.layer &&
        Math.hypot(first.x - last.x, first.y - last.y) <= CONTACT_EPSILON
      for (const [endpoint, point, connected] of [
        ["start", first, firstConnected],
        ["end", last, lastConnected],
      ] as const) {
        if (
          connected ||
          point.route_type !== "wire" ||
          (endpoint === "end" && endpointsAreSame && !firstConnected)
        )
          continue
        errors.push({
          type: "pcb_trace_error",
          message: `Trace [${traceName(trace)}] has disconnected endpoint at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`,
          source_trace_id:
            source?.id || trace.source_trace_id || `!${trace.pcb_trace_id}`,
          error_type: "pcb_trace_error",
          pcb_trace_id: trace.pcb_trace_id,
          pcb_trace_error_id: `disconnected_endpoint_${trace.pcb_trace_id}_${endpoint}`,
          center: { x: point.x, y: point.y },
          pcb_component_ids: [],
          pcb_port_ids: [],
        })
      }
    }
  }
  return errors
}
