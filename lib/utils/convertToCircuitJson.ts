import type {
  AnyCircuitElement,
  PcbBoard,
  PcbTrace,
  PcbVia,
  SourceTrace,
} from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../types"
import type { HighDensityRoute } from "../types/high-density-types"
import { getConnectionPointLayers } from "../types/srj-types"
import { getViaLayers } from "./getViaLayers"
import { getObstaclePadMetadata } from "./getObstaclePadMetadata"
import { mapZToLayerName } from "./mapZToLayerName"

type WireRoutePoint = Extract<PcbTrace["route"][number], { route_type: "wire" }>
type CircuitJsonLayer = WireRoutePoint["layer"]

function getCircuitJsonLayer(layer: string): CircuitJsonLayer {
  switch (layer) {
    case "top":
    case "bottom":
    case "inner1":
    case "inner2":
    case "inner3":
    case "inner4":
    case "inner5":
    case "inner6":
    case "inner7":
    case "inner8":
      return layer
    default:
      throw new Error(`Unsupported Circuit JSON layer: ${layer}`)
  }
}

/**
 * Convert a simplified PCB trace from the autorouter to a circuit-json compatible PCB trace
 */
function convertSimplifiedPcbTraceToCircuitJson(
  simplifiedTrace: SimplifiedPcbTrace,
  connectionName: string,
): PcbTrace {
  return {
    type: "pcb_trace",
    pcb_trace_id: simplifiedTrace.pcb_trace_id,
    source_trace_id: connectionName,
    route: simplifiedTrace.route
      .map((segment) => {
        if (segment.route_type === "wire") {
          return {
            route_type: "wire" as const,
            x: segment.x,
            y: segment.y,
            width: segment.width,
            layer: getCircuitJsonLayer(segment.layer),
            start_pcb_port_id: (segment as any).start_pcb_port_id,
            end_pcb_port_id: (segment as any).end_pcb_port_id,
          }
        } else if (segment.route_type === "via") {
          return {
            route_type: "via" as const,
            x: segment.x,
            y: segment.y,
            from_layer: getCircuitJsonLayer(segment.from_layer),
            to_layer: getCircuitJsonLayer(segment.to_layer),
          }
        } else {
          // jumper - skip for now as circuit-json doesn't support jumper route type
          return null
        }
      })
      .filter((segment) => segment !== null),
  }
}

/**
 * Convert a high density route from the autorouter to circuit-json compatible PCB traces.
 * When a route contains jumpers, it splits into multiple disjoint traces that share the
 * same source_trace_id (since they're electrically connected through the jumper component).
 */
function convertHdRouteToCircuitJsonTraces(
  hdRoute: HighDensityRoute,
  baseId: string,
  connectionName: string,
  width = 0.1,
  layerCount: number,
): PcbTrace[] {
  const traces: PcbTrace[] = []

  // If no jumpers, return single trace
  if (!hdRoute.jumpers || hdRoute.jumpers.length === 0) {
    return [
      {
        type: "pcb_trace",
        pcb_trace_id: baseId,
        source_trace_id: connectionName,
        route: hdRoute.route.map((point, index): WireRoutePoint => {
          const isFirstPoint = index === 0
          const isLastPoint = index === hdRoute.route.length - 1
          return {
            route_type: "wire",
            x: point.x,
            y: point.y,
            width,
            layer: getCircuitJsonLayer(mapZToLayerName(point.z, layerCount)),
            ...(isFirstPoint && (point as any).pcb_port_id
              ? { start_pcb_port_id: (point as any).pcb_port_id }
              : {}),
            ...(isLastPoint && (point as any).pcb_port_id
              ? { end_pcb_port_id: (point as any).pcb_port_id }
              : {}),
          }
        }),
      },
    ]
  }

  // Build a set of jumper endpoint indices (where we need to split the trace)
  // Each jumper creates a "gap" in the trace
  const jumperEndpoints: Array<{
    startIdx: number
    endIdx: number
  }> = []

  for (const jumper of hdRoute.jumpers) {
    let startIdx = -1
    let endIdx = -1

    for (let i = 0; i < hdRoute.route.length; i++) {
      const p = hdRoute.route[i]!
      if (
        Math.abs(p.x - jumper.start.x) < 0.01 &&
        Math.abs(p.y - jumper.start.y) < 0.01
      ) {
        startIdx = i
      }
      if (
        Math.abs(p.x - jumper.end.x) < 0.01 &&
        Math.abs(p.y - jumper.end.y) < 0.01
      ) {
        endIdx = i
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      // Ensure startIdx < endIdx
      if (startIdx > endIdx) {
        ;[startIdx, endIdx] = [endIdx, startIdx]
      }
      jumperEndpoints.push({ startIdx, endIdx })
    }
  }

  // Sort jumper endpoints by startIdx
  jumperEndpoints.sort((a, b) => a.startIdx - b.startIdx)

  // Split the route into segments between jumpers
  let currentStart = 0
  let traceIndex = 0

  for (const { startIdx, endIdx } of jumperEndpoints) {
    // Create trace from currentStart to startIdx (inclusive)
    if (startIdx >= currentStart) {
      const segmentPoints = hdRoute.route.slice(currentStart, startIdx + 1)
      if (segmentPoints.length > 0) {
        traces.push({
          type: "pcb_trace",
          pcb_trace_id: `${baseId}_${traceIndex}`,
          source_trace_id: connectionName,
          route: segmentPoints.map((point, index): WireRoutePoint => {
            const isFirstPoint = index === 0 && currentStart === 0
            const isLastPoint = false // Not the overall last point
            return {
              route_type: "wire",
              x: point.x,
              y: point.y,
              width,
              layer: getCircuitJsonLayer(mapZToLayerName(point.z, layerCount)),
              ...(isFirstPoint && (point as any).pcb_port_id
                ? { start_pcb_port_id: (point as any).pcb_port_id }
                : {}),
            }
          }),
        })
        traceIndex++
      }
    }
    // Skip from startIdx to endIdx (this is the jumper segment)
    currentStart = endIdx
  }

  // Create final trace from last jumper end to route end
  if (currentStart < hdRoute.route.length) {
    const segmentPoints = hdRoute.route.slice(currentStart)
    if (segmentPoints.length > 0) {
      const isLastSegment = true
      traces.push({
        type: "pcb_trace",
        pcb_trace_id: `${baseId}_${traceIndex}`,
        source_trace_id: connectionName,
        route: segmentPoints.map((point, index): WireRoutePoint => {
          const isLastPoint =
            isLastSegment && index === segmentPoints.length - 1
          return {
            route_type: "wire",
            x: point.x,
            y: point.y,
            width,
            layer: getCircuitJsonLayer(mapZToLayerName(point.z, layerCount)),
            ...(isLastPoint && (point as any).pcb_port_id
              ? { end_pcb_port_id: (point as any).pcb_port_id }
              : {}),
          }
        }),
      })
    }
  }

  return traces
}

/** Resolve only declared aliases; conflicting aliases must not merge nets. */
function getDeclaredConnectionMap(srj: SimpleRouteJson): Map<string, string> {
  const connectionMap = new Map<string, string>()
  const ambiguousAliases = new Set<string>()
  for (const connection of srj.connections) {
    const canonicalName =
      connection.netConnectionName ??
      connection.__rootConnectionNames?.[0] ??
      connection.rootConnectionName ??
      connection.name
    const aliases = [
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
      ...(connection.mergedConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ]
    for (const alias of aliases) {
      if (!alias || ambiguousAliases.has(alias)) continue
      const previousName = connectionMap.get(alias)
      if (previousName !== undefined && previousName !== canonicalName) {
        connectionMap.delete(alias)
        ambiguousAliases.add(alias)
      } else {
        connectionMap.set(alias, canonicalName)
      }
    }
  }
  return connectionMap
}

/** Build logical connectivity independently of the candidate route geometry. */
function createSourceTraces(
  srj: SimpleRouteJson,
  connectionMap: Map<string, string>,
): SourceTrace[] {
  const sourceTraces = new Map<string, SourceTrace>()
  for (const connection of srj.connections) {
    const canonicalName =
      connection.netConnectionName ??
      connection.__rootConnectionNames?.[0] ??
      connection.rootConnectionName ??
      connection.name
    const sourceTrace = sourceTraces.get(canonicalName) ?? {
      type: "source_trace" as const,
      source_trace_id: canonicalName,
      connected_source_port_ids: [],
      connected_source_net_ids: [],
    }
    sourceTrace.connected_source_port_ids = [
      ...new Set([
        ...sourceTrace.connected_source_port_ids,
        ...connection.pointsToConnect.flatMap((point) =>
          point.pcb_port_id ? [point.pcb_port_id] : [],
        ),
      ]),
    ]
    sourceTrace.connected_source_net_ids = [
      ...new Set([
        ...(sourceTrace.connected_source_net_ids ?? []),
        ...connection.pointsToConnect.flatMap((point) =>
          point.pointId && connectionMap.get(point.pointId) === canonicalName
            ? [point.pointId]
            : [],
        ),
      ]),
    ]
    sourceTraces.set(canonicalName, sourceTrace)
  }

  const portPositionMap = getPcbPortPositionMap(srj)
  const declaredPcbPortIds = new Set(portPositionMap.keys())
  for (const obstacle of srj.obstacles) {
    const { smtPadId, platedHoleId, pcbPortId, viaId } = getObstaclePadMetadata(
      obstacle,
      declaredPcbPortIds,
      portPositionMap,
    )
    if (viaId || (!smtPadId && !platedHoleId && !pcbPortId)) continue
    const portConnectionName = pcbPortId
      ? connectionMap.get(pcbPortId)
      : undefined
    const declaredNetNames = new Set(
      obstacle.connectedTo.flatMap((id) => {
        const canonicalName = connectionMap.get(id)
        return canonicalName ? [canonicalName] : []
      }),
    )
    const canonicalName =
      portConnectionName ??
      (declaredNetNames.size === 1
        ? declaredNetNames.values().next().value
        : undefined)
    if (!canonicalName) continue
    const sourceTrace = sourceTraces.get(canonicalName)
    if (!sourceTrace) continue
    if (pcbPortId) {
      sourceTrace.connected_source_port_ids = [
        ...new Set([...sourceTrace.connected_source_port_ids, pcbPortId]),
      ]
    } else {
      // An explicit SRJ net alias can associate pad geometry without a PCB port.
      sourceTrace.connected_source_net_ids = [
        ...new Set([
          ...(sourceTrace.connected_source_net_ids ?? []),
          ...(smtPadId ? [smtPadId] : []),
          ...(platedHoleId ? [platedHoleId] : []),
        ]),
      ]
    }
  }
  return [...sourceTraces.values()]
}

/**
 * Create circuit-json pcb_port elements for the connection points
 */
function createPcbPorts(srj: SimpleRouteJson): AnyCircuitElement[] {
  const portMap = new Map<string, any>()

  srj.connections.forEach((connection) => {
    connection.pointsToConnect.forEach((point) => {
      if (point.pcb_port_id) {
        portMap.set(point.pcb_port_id, {
          type: "pcb_port",
          pcb_port_id: point.pcb_port_id,
          source_port_id: point.pcb_port_id, // Assuming same ID for simplicity
          x: point.x,
          y: point.y,
          layers: getConnectionPointLayers(point).map(getCircuitJsonLayer),
        })
      }
    })
  })

  return Array.from(portMap.values())
}

function getPcbPortPositionMap(srj: SimpleRouteJson) {
  const portPositionMap = new Map<string, { x: number; y: number }>()

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue
      portPositionMap.set(point.pcb_port_id, { x: point.x, y: point.y })
    }
  }
  for (const obstacle of srj.obstacles) {
    const pcbPortId = obstacle.circuitJsonMetadata?.pcb_port_id
    if (pcbPortId && !portPositionMap.has(pcbPortId)) {
      portPositionMap.set(pcbPortId, obstacle.center)
    }
  }

  return portPositionMap
}

/**
 * Create pad-like circuit-json elements from SRJ obstacles.
 * Multi-layer obstacles represent plated holes and must not be deduped away
 * against top-side SMT pads that share the same connectivity metadata.
 */
function createPcbPadElements(srj: SimpleRouteJson): AnyCircuitElement[] {
  const pads: AnyCircuitElement[] = []
  const addedSmtPadIds = new Set<string>()
  const addedPlatedHoleIds = new Set<string>()
  const portPositionMap = getPcbPortPositionMap(srj)
  const declaredPcbPortIds = new Set(portPositionMap.keys())

  for (const obstacle of srj.obstacles) {
    const { smtPadId, platedHoleId, pcbPortId, viaId } = getObstaclePadMetadata(
      obstacle,
      declaredPcbPortIds,
      portPositionMap,
    )
    if (viaId) continue
    if (!smtPadId && !platedHoleId && !pcbPortId) continue

    const layers = obstacle.layers.map(getCircuitJsonLayer)
    if (layers.length === 0) continue

    const width = obstacle.width
    const height = obstacle.height
    const x = obstacle.center.x
    const y = obstacle.center.y
    const rotationDegrees = obstacle.ccwRotationDegrees
    const isRotated =
      typeof rotationDegrees === "number" && Number.isFinite(rotationDegrees)

    const isMultiLayerObstacle = Boolean(platedHoleId) || layers.length > 1

    if (isMultiLayerObstacle) {
      const id =
        platedHoleId ?? `pcb_plated_hole_${x.toFixed(3)}_${y.toFixed(3)}`
      if (addedPlatedHoleIds.has(id)) continue
      addedPlatedHoleIds.add(id)

      if (isRotated) {
        const holeDiameter = Math.max(Math.min(width, height) * 0.5, 0.1)
        pads.push({
          type: "pcb_plated_hole",
          pcb_plated_hole_id: id,
          shape: "rotated_pill_hole_with_rect_pad",
          hole_shape: "rotated_pill",
          pad_shape: "rect",
          hole_width: holeDiameter,
          hole_height: holeDiameter,
          hole_ccw_rotation: rotationDegrees,
          rect_pad_width: width,
          rect_pad_height: height,
          rect_ccw_rotation: rotationDegrees,
          hole_offset_x: 0,
          hole_offset_y: 0,
          x,
          y,
          layers,
          ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
        })
        continue
      }

      const isCircularLike = Math.abs(width - height) < 0.001

      if (isCircularLike) {
        pads.push({
          type: "pcb_plated_hole",
          pcb_plated_hole_id: id,
          shape: "circle",
          outer_diameter: Math.max(width, height),
          hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
          x,
          y,
          layers,
          ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
        } as any)
        continue
      }

      pads.push({
        type: "pcb_plated_hole",
        pcb_plated_hole_id: id,
        shape: "circular_hole_with_rect_pad",
        hole_shape: "circle",
        hole_diameter: Math.max(Math.min(width, height) * 0.5, 0.1),
        rect_pad_width: width,
        rect_pad_height: height,
        hole_offset_x: 0,
        hole_offset_y: 0,
        x,
        y,
        layers,
        ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
      } as any)
      continue
    }

    const id = smtPadId ?? `pcb_smtpad_${x.toFixed(3)}_${y.toFixed(3)}`
    if (addedSmtPadIds.has(id)) continue
    addedSmtPadIds.add(id)

    if (isRotated) {
      pads.push({
        type: "pcb_smtpad",
        pcb_smtpad_id: id,
        layer: layers[0]!,
        shape: "rotated_rect",
        width,
        height,
        ccw_rotation: rotationDegrees,
        x,
        y,
        ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
      })
      continue
    }

    pads.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: id,
      layer: layers[0]!,
      shape: "rect",
      width,
      height,
      x,
      y,
      ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
    } as any)
  }

  return pads
}

/**
 * Extract vias from routes and convert them to pcb_via objects
 * @param routes The routes to extract vias from
 * @param minViaDiameter Default diameter for vias
 * @returns An array of PcbVia elements
 */
function extractViasFromRoutes(
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  layerCount: number,
  minViaDiameter = 0.3,
  allowBlindAndBuriedVias = false,
  minViaHoleDiameter = minViaDiameter * 0.5,
): PcbVia[] {
  const vias: PcbVia[] = []
  const viaLocations = new Set<string>() // Track unique via locations

  if (routes.length > 0) {
    if ("type" in routes[0]! && routes[0]!.type === "pcb_trace") {
      // Extract vias from SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        trace.route.forEach((segment) => {
          if (segment.route_type === "via") {
            const viaDiameter = segment.via_diameter ?? minViaDiameter
            const locationKey = `${segment.x},${segment.y},${segment.from_layer},${segment.to_layer}`
            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: trace.pcb_trace_id,
                x: segment.x,
                y: segment.y,
                outer_diameter: viaDiameter,
                hole_diameter: segment.via_hole_diameter ?? minViaHoleDiameter,
                layers: getViaLayers(
                  segment,
                  layerCount,
                  allowBlindAndBuriedVias,
                ).map(getCircuitJsonLayer),
              })
              viaLocations.add(locationKey)
            }
          }
        })
      })
    } else {
      // Extract vias from HighDensityRoutes by looking for layer changes
      ;(routes as HighDensityRoute[]).forEach((route, routeIndex) => {
        const traceId = `trace_${routeIndex}`
        const viaDiameter = route.viaDiameter ?? minViaDiameter
        for (let i = 1; i < route.route.length; i++) {
          const prevPoint = route.route[i - 1]!
          const currPoint = route.route[i]!

          // If z-coordinate changes, we have a via
          if (
            prevPoint.z !== currPoint.z &&
            Math.abs(prevPoint.x - currPoint.x) < 0.01 &&
            Math.abs(prevPoint.y - currPoint.y) < 0.01
          ) {
            const fromLayer = mapZToLayerName(prevPoint.z, layerCount)
            const toLayer = mapZToLayerName(currPoint.z, layerCount)
            const locationKey = `${currPoint.x},${currPoint.y},${fromLayer},${toLayer}`

            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: traceId,
                x: currPoint.x,
                y: currPoint.y,
                outer_diameter: viaDiameter,
                hole_diameter: route.viaHoleDiameter ?? minViaHoleDiameter,
                layers: getViaLayers(
                  { from_layer: fromLayer, to_layer: toLayer },
                  layerCount,
                  allowBlindAndBuriedVias,
                ).map(getCircuitJsonLayer),
              })
              viaLocations.add(locationKey)
            }
          }
        }
      })
    }
  }

  return vias
}

export function createPcbBoardElement(srj: SimpleRouteJson): PcbBoard {
  const { minX, maxX, minY, maxY } = srj.bounds
  return {
    type: "pcb_board",
    pcb_board_id: "__autorouting_board__",
    thickness: 1.6,
    num_layers: srj.layerCount,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
    material: "fr4",
    ...(srj.outline?.length
      ? { shape: "polygon" as const, outline: srj.outline }
      : { shape: "rect" as const }),
    ...(srj.minBoardEdgeClearance !== undefined
      ? { min_board_edge_clearance: srj.minBoardEdgeClearance }
      : {}),
    ...(srj.minTraceToPadEdgeClearance !== undefined
      ? { min_trace_to_pad_edge_clearance: srj.minTraceToPadEdgeClearance }
      : {}),
    ...(srj.minPadEdgeToPadEdgeClearance !== undefined
      ? { min_pad_edge_to_pad_edge_clearance: srj.minPadEdgeToPadEdgeClearance }
      : {}),
    ...(srj.minViaHoleEdgeToViaHoleEdgeClearance !== undefined
      ? {
          min_via_hole_edge_to_via_hole_edge_clearance:
            srj.minViaHoleEdgeToViaHoleEdgeClearance,
        }
      : {}),
  }
}

/**
 * Convert the autorouter output to circuit-json format
 * @param srjWithPointPairs The SimpleRouteJson created by the NetToPointPairsSolver
 * @param routes The SimplifiedPcbTraces or HighDensityRoutes to convert
 * @param minTraceWidth Default width for traces if not specified
 * @param minViaDiameter Default diameter for vias if not specified
 */
export function convertToCircuitJson(
  srjWithPointPairs: SimpleRouteJson,
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  minTraceWidth = 0.1,
  minViaDiameter = srjWithPointPairs.min_via_pad_diameter ??
    srjWithPointPairs.minViaPadDiameter ??
    srjWithPointPairs.minViaDiameter ??
    0.3,
): AnyCircuitElement[] {
  // Start with empty circuit JSON
  const circuitJson: AnyCircuitElement[] = []
  circuitJson.push(createPcbBoardElement(srjWithPointPairs))
  const connectionMap = getDeclaredConnectionMap(srjWithPointPairs)

  // Add source traces from connection information
  circuitJson.push(...createSourceTraces(srjWithPointPairs, connectionMap))

  // Add PCB ports for connection points
  circuitJson.push(...createPcbPorts(srjWithPointPairs))

  // Add PCB pads / plated holes represented by SRJ obstacles
  circuitJson.push(...createPcbPadElements(srjWithPointPairs))

  // Extract and add vias as independent pcb_via elements
  circuitJson.push(
    ...extractViasFromRoutes(
      routes,
      srjWithPointPairs.layerCount,
      minViaDiameter,
      srjWithPointPairs.allowBlindAndBuriedVias,
      srjWithPointPairs.min_via_hole_diameter ??
        srjWithPointPairs.minViaHoleDiameter ??
        minViaDiameter * 0.5,
    ),
  )

  // Process routes based on their type
  if (routes.length > 0) {
    if ("type" in routes[0]! && routes[0]!.type === "pcb_trace") {
      // Handle SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        const connectionName = trace.connection_name
        circuitJson.push(
          convertSimplifiedPcbTraceToCircuitJson(
            trace,
            connectionMap.get(connectionName) || connectionName,
          ) as AnyCircuitElement,
        )
      })
    } else {
      // Handle HighDensityRoutes - may produce multiple traces per route if jumpers exist
      ;(routes as HighDensityRoute[]).forEach((route, index) => {
        const connectionName = route.connectionName
        const traces = convertHdRouteToCircuitJsonTraces(
          route,
          `trace_${index}`,
          connectionMap.get(connectionName) || connectionName,
          minTraceWidth,
          srjWithPointPairs.layerCount,
        )
        circuitJson.push(...(traces as AnyCircuitElement[]))
      })
    }
  }

  return circuitJson
}
