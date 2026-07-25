import { expect, test } from "bun:test"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

test("uses evaluator-provided location-aware errors for repair targeting", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 2 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "A",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = () => ({
    errors: [
      {
        type: "pcb_trace_error",
        center: { x: 100, y: 100 },
      },
    ],
    errorsWithCenters: [
      {
        type: "pcb_trace_error",
        center: { x: 0.5, y: 0 },
      },
    ],
  })

  const snapshot = getDrcSnapshot(srj, routes, drcEvaluator)

  expect(snapshot.count).toBe(1)
  expect(snapshot.errors[0]?.center).toEqual({ x: 0.5, y: 0 })
})
