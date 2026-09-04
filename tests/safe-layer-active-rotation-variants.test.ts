import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getSafeTraceLayerFullSpanVariants,
  materializeRoutes,
  SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("full-span enumeration preserves ordered unique geometry using only active terminal rotations", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
    connections: [{ name: "trace", pointsToConnect: [] }],
    obstacles: [-1, 1].map((x) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["trace", x < 0 ? "start_port" : "end_port"],
    })),
  }
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    center: { x: 0, y: 0 },
  }
  const cases = [
    { start: false, end: false, otherLayer: false, directions: [0] },
    {
      start: true,
      end: false,
      otherLayer: false,
      directions: [0, 3, 4, 11, 12, 23, 24, 38],
    },
    {
      start: false,
      end: true,
      otherLayer: false,
      directions: [0, 1, 2, 5, 6, 13, 14, 25],
    },
    {
      start: true,
      end: true,
      otherLayer: false,
      directions: Array.from({ length: 64 }, (_, index) => index),
    },
    { start: true, end: true, otherLayer: true, directions: [0] },
  ]
  for (const { start, end, otherLayer, directions } of cases) {
    const points: HighDensityRoute["route"] = [
      { x: -1, y: 0, z: 0, ...(start ? { pcb_port_id: "start_port" } : {}) },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0, ...(end ? { pcb_port_id: "end_port" } : {}) },
    ]
    if (otherLayer) {
      points[0]!.pcb_port_id = undefined
      points[2]!.pcb_port_id = undefined
      points.unshift(
        { x: -2, y: 1, z: 1, pcb_port_id: "start_port" },
        { x: -1, y: 0, z: 1 },
      )
      points.push(
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 1, z: 1, pcb_port_id: "end_port" },
      )
    }
    const routes: HighDensityRoute[] = [
      {
        connectionName: "trace",
        route: points,
        vias: otherLayer ? [{ x: -1, y: 0 }, { x: 1, y: 0 }] : [],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ]
    const variants = getSafeTraceLayerFullSpanVariants(srj, routes, error, [0])
    expect(variants).toEqual(
      directions.flatMap((directionVariant) =>
        [0, 1].map((targetZ) => ({ routeIndex: 0, targetZ, directionVariant })),
      ),
    )
    const legacyVariants = Array.from(
      { length: SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT },
      (_, directionVariant) =>
        [0, 1].map((targetZ) => ({ routeIndex: 0, targetZ, directionVariant })),
    ).flat()
    const geometries = (candidateVariants: typeof variants): string[] => {
      const result: string[] = []
      for (const variant of candidateVariants) {
        const { routeIndex, targetZ, directionVariant } = variant
        const candidateRoutes = cloneRoutes(routes)
        if (
          applySafeTraceLayerMoveForError(
            srj,
            candidateRoutes,
            error,
            routeIndex,
            targetZ,
            "full",
            undefined,
            directionVariant,
          )
        ) {
          result.push(JSON.stringify(materializeRoutes(candidateRoutes)))
        }
      }
      return result
    }
    const actualGeometries = geometries(variants)
    expect(actualGeometries).toEqual([...new Set(geometries(legacyVariants))])
    expect(actualGeometries).toHaveLength(directions.length)
  }
})
