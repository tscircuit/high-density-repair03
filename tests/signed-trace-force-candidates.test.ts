import { expect, test } from "bun:test"
import { getDrcErrorForceCandidates } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

test("signed trace forces retain distinct positive and negative scale candidates", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [{ name: "trace", pointsToConnect: [] }],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const candidates = [
    ...getDrcErrorForceCandidates(
      srj,
      routes,
      {
        type: "pcb_trace_error",
        pcb_trace_id: "trace_0",
        center: { x: 0, y: 0.1 },
      },
      new Map([["trace_0", 0]]),
      [1, 1.75, -1],
    ),
  ]

  expect(candidates).toHaveLength(3)
  expect(candidates[0]![0]!.route[1]!.y).toBeCloseTo(-0.14, 8)
  expect(candidates[1]![0]!.route[1]!.y).toBeCloseTo(-0.245, 8)
  expect(candidates[2]![0]!.route[1]!.y).toBeCloseTo(0.14, 8)
  expect(routes[0]!.route[1]!.y).toBe(0)
})
