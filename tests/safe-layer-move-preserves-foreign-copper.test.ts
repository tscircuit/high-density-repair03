import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("safe layer moves reject newly added wire and via shorts while retaining incoming copper", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
  }
  const route = (
    name: string,
    points: HighDensityRoute["route"],
  ): HighDensityRoute => ({
    connectionName: name,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: points,
    vias: [],
  })
  const moving = route("moving", [
    { x: -2, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
  const error = { type: "pcb_trace_error", center: { x: 0, y: 0 } }
  const foreignCases = [
    route("foreign", [
      { x: 0, y: -1, z: 1 },
      { x: 0, y: 1, z: 1 },
    ]),
    route("foreign", [
      { x: -1, y: 0.09, z: 1 },
      { x: 1, y: 0.09, z: 1 },
    ]),
    route("foreign", [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
    ]),
    route("foreign", [
      { x: -2.1, y: 0.15, z: 1 },
      { x: -1.9, y: 0.15, z: 1 },
    ]),
    route("foreign", [
      { x: -0.1, y: 0.2, z: 1, traceThickness: 0.1 },
      { x: 0.1, y: 0.2, z: 1, traceThickness: 0.4 },
    ]),
    route("foreign", [
      { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0, y: 0, z: 3 },
    ]),
    route("foreign", [
      {
        x: -0.2,
        y: 0.2,
        z: 0,
        traceThickness: 0.4,
        toNextSegmentType: "through_obstacle",
      },
      { x: 0.2, y: 0.2, z: 3, traceThickness: 0.4 },
    ]),
  ]
  for (const foreign of foreignCases) {
    const routes = cloneRoutes([moving, foreign])
    const before = structuredClone(routes)
    expect(
      applySafeTraceLayerMoveForError(srj, routes, error, 0, 1, 0),
    ).toBe(false)
    expect(routes).toEqual(before)
  }
  const fixed = foreignCases[0]!
  const fixedRoutes = cloneRoutes([moving])
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      fixedRoutes,
      error,
      0,
      1,
      0,
      undefined,
      0,
      false,
      [fixed],
    ),
  ).toBe(false)
  const sameNet = cloneRoutes([moving, { ...fixed, connectionName: "moving" }])
  expect(
    applySafeTraceLayerMoveForError(srj, sameNet, error, 0, 1, 0),
  ).toBe(true)
  const otherLayer = cloneRoutes([
    moving,
    route("foreign", [
      { x: 0, y: -1, z: 2 },
      { x: 0, y: 1, z: 2 },
    ]),
  ])
  expect(
    applySafeTraceLayerMoveForError(srj, otherLayer, error, 0, 1, 0),
  ).toBe(true)
  const existing = cloneRoutes([
    route("moving", [
      { x: -3, y: 0, z: 0 },
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ]),
    route("foreign", [
      { x: -2.5, y: -1, z: 0 },
      { x: -2.5, y: 1, z: 0 },
    ]),
  ])
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      existing,
      { ...error, center: { x: -0.5, y: 0 } },
      0,
      1,
      0,
    ),
  ).toBe(true)
  expect(existing[0]!.route.slice(0, 2)).toEqual([
    { x: -3, y: 0, z: 0 },
    { x: -2, y: 0, z: 0 },
  ])
})
