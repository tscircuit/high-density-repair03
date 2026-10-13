import { expect, test } from "bun:test"
import {
  applyBroadRepulsionForces,
  applyDrcErrorForces,
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyTraceToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/traceToPadClearanceRelaxation"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

type RoutePoint = Pick<HighDensityRoute["route"][number], "x" | "y" | "z">
type PhysicalRouteJson = Omit<SimpleRouteJson, "obstacles"> & {
  obstacles: Array<SimpleRouteJson["obstacles"][number] & { shape?: "circle" }>
}

test("keeps retained copper boundaries fixed during repair", (): void => {
  const srj: PhysicalRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      { name: "foreign_pad", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top", "bottom"],
        center: { x: -1, y: 0 },
        width: 0.45,
        height: 0.45,
        connectedTo: ["pcb_via_left", "signal"],
      },
      {
        type: "rect",
        shape: "circle",
        layers: ["top", "bottom"],
        center: { x: 1, y: 0 },
        width: 0.45,
        height: 0.45,
        connectedTo: ["pcb_via_right", "signal"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0.03 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign", "foreign_pad"],
      },
    ],
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: -0.4, y: 0, z: 0 },
        { x: 0.4, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const original = structuredClone(input)
  const snapshot = getDrcSnapshot(srj, input)
  expect(snapshot.count).toBeGreaterThan(0)
  const ordinary = cloneRoutes(input)
  expect(
    applyDrcErrorForces(
      srj,
      ordinary,
      snapshot.errors,
      snapshot.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(ordinary[0]!.route[0]!.y).not.toBe(0)
  expect(ordinary[0]!.route.at(-1)!.y).not.toBe(0)

  const explicitFalse = cloneRoutes(input)
  explicitFalse[0]!.route[0]!.isFixedToCopperBoundary = false
  explicitFalse[0]!.route.at(-1)!.isFixedToCopperBoundary = false
  expect(
    applyDrcErrorForces(
      srj,
      explicitFalse,
      snapshot.errors,
      snapshot.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(
    explicitFalse[0]!.route.map(({ x, y, z }): RoutePoint => ({ x, y, z })),
  ).toEqual(ordinary[0]!.route.map(({ x, y, z }): RoutePoint => ({ x, y, z })))

  const anchored = cloneRoutes(input)
  anchored[0]!.route[0]!.isFixedToCopperBoundary = true
  anchored[0]!.route.at(-1)!.isFixedToCopperBoundary = true
  const anchoredInput = structuredClone(anchored)
  expect(
    applyDrcErrorForces(
      srj,
      anchored,
      snapshot.errors,
      snapshot.traceRouteIndexById,
      1,
    ),
  ).toBe(true)
  expect(anchored[0]!.route[0]).toEqual(anchoredInput[0]!.route[0])
  expect(anchored[0]!.route.at(-1)).toEqual(anchoredInput[0]!.route.at(-1))
  expect(
    anchored[0]!.route.some(
      (point, index): boolean =>
        index > 0 &&
        index < anchored[0]!.route.length - 1 &&
        (point.x !== anchoredInput[0]!.route[index]?.x ||
          point.y !== anchoredInput[0]!.route[index]?.y),
    ),
  ).toBe(true)
  expect(getDrcSnapshot(srj, anchored).issueScore).toBeLessThan(
    snapshot.issueScore,
  )
  const materialized = materializeRoutes(anchored)
  const broad = applyBroadRepulsionForces(srj, materialized, 1)
  const relaxed = applyTraceToPadClearanceRelaxation(srj, broad)
  for (const routes of [materialized, broad, relaxed]) {
    expect(routes[0]!.route[0]).toEqual(anchoredInput[0]!.route[0])
    expect(routes[0]!.route.at(-1)).toEqual(anchoredInput[0]!.route.at(-1))
    expect(routes[0]!.traceThickness).toBe(0.1)
    expect(routes[0]!.viaDiameter).toBe(0.45)
    expect(routes[0]!.route.every((point): boolean => point.z === 0)).toBe(true)
    expect(routes[0]!.route.every((point): boolean => !point.pcb_port_id)).toBe(
      true,
    )
  }
  expect(input).toEqual(original)

  const duplicateBoundary = cloneRoutes(input)
  duplicateBoundary[0]!.route.splice(1, 0, { ...input[0]!.route[0]! })
  const falseDuplicateBoundary = cloneRoutes(duplicateBoundary)
  falseDuplicateBoundary[0]!.route[0]!.isFixedToCopperBoundary = false
  const actualError = snapshot.errors[0]
  if (!actualError) throw new Error("Expected a measured foreign-pad conflict")
  for (const routes of [duplicateBoundary, falseDuplicateBoundary]) {
    expect(
      applySafeTraceLayerMoveForError(srj, routes, actualError, 0, 1, "full"),
    ).toBe(true)
  }
  expect(
    falseDuplicateBoundary[0]!.route.map(
      ({ x, y, z }): RoutePoint => ({ x, y, z }),
    ),
  ).toEqual(
    duplicateBoundary[0]!.route.map(({ x, y, z }): RoutePoint => ({ x, y, z })),
  )
  const anchoredLayerMove = cloneRoutes(anchoredInput)
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      anchoredLayerMove,
      actualError,
      0,
      1,
      "full",
    ),
  ).toBe(true)
  expect(anchoredLayerMove[0]!.route[0]).toEqual(anchoredInput[0]!.route[0])
  expect(anchoredLayerMove[0]!.route.at(-1)).toEqual(
    anchoredInput[0]!.route.at(-1),
  )
  expect(
    anchoredLayerMove[0]!.route
      .filter((point): boolean => Boolean(point.isFixedToCopperBoundary))
      .map(({ x, y, z }): RoutePoint => ({ x, y, z })),
  ).toEqual([
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ])
})
