import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcErrorForceCandidates,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a saturated via correction retains scale-dependent obstacle moves in the same candidate", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.4,
    connections: [
      { name: "trace", pointsToConnect: [] },
      { name: "via", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.2 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      route: [-2, -1, 0, 1, 2].map((x) => ({ x, y: 0.35, z: 0 })),
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "via",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 0.4, z: 0 },
        { x: 0, y: 0.4, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 0.4 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const error = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_0",
    message: "PCB trace trace_0 overlaps pcb_smtpad foreign",
    center: { x: 0, y: 0.35 },
  }
  const traceRouteIndexById = new Map([["trace_0", 0]])
  const originalRoutes = structuredClone(routes)
  const scales = [1, 1.75, -1, -1.75]
  const individuallyAppliedCandidates = scales.map((scale) => {
    const candidateRoutes = cloneRoutes(routes)
    expect(
      applyDrcErrorForces(
        srj,
        candidateRoutes,
        [error],
        traceRouteIndexById,
        scale,
      ),
    ).toBe(true)
    return materializeRoutes(candidateRoutes)
  })
  const candidates = [
    ...getDrcErrorForceCandidates(
      srj,
      routes,
      error,
      traceRouteIndexById,
      scales,
    ),
  ]

  expect(candidates).toHaveLength(2)
  expect(candidates).toEqual(individuallyAppliedCandidates.slice(0, 2))
  expect(individuallyAppliedCandidates[2]).toEqual(candidates[0])
  expect(individuallyAppliedCandidates[3]).toEqual(candidates[1])
  expect(candidates[0]![0]!.route[2]!.y).toBeCloseTo(0.385, 8)
  expect(candidates[1]![0]!.route[2]!.y).toBeCloseTo(0.48, 8)
  expect(candidates[0]![1]).toEqual(candidates[1]![1])
  expect(routes).toEqual(originalRoutes)
})
