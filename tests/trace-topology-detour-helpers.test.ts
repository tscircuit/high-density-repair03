import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyTraceSpanDetourForError,
  applyTraceWaypointDetourForError,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("creates bounded same-layer span and waypoint detours", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [{ name: "route_0", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const inputRoute: HighDensityRoute = {
    connectionName: "route_0",
    route: [0, 1, 2, 3, 4].map((x) => ({ x, y: 0, z: 0 })),
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "route_0_0",
    center: { x: 2.5, y: 0 },
  }

  const spanRoutes = [structuredClone(inputRoute)]
  expect(applyTraceSpanDetourForError(srj, spanRoutes, error, 0, 1, 1, 1)).toBe(
    true,
  )
  expect(spanRoutes[0]!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 4, y: 1, z: 0 },
    { x: 4, y: 0, z: 0 },
  ])

  const waypointRoutes = [structuredClone(inputRoute)]
  expect(
    applyTraceWaypointDetourForError(srj, waypointRoutes, error, 0, 1, {
      x: 2.5,
      y: -1,
    }),
  ).toBe(true)
  expect(waypointRoutes[0]!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2.5, y: -1, z: 0 },
    { x: 4, y: 0, z: 0 },
  ])

  const outsideRoutes = [structuredClone(inputRoute)]
  expect(
    applyTraceWaypointDetourForError(srj, outsideRoutes, error, 0, 1, {
      x: 6,
      y: 0,
    }),
  ).toBe(false)
  expect(outsideRoutes).toEqual([inputRoute])
})
