import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("disabled broad searches do not delay detection of a DRC plateau", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = Array.from({ length: 121 }, (_, i) => ({
    connectionName: `route_${i}`,
    route: [
      { x: 1, y: i, z: 0 },
      { x: 9, y: i, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }))
  const errors = Array.from({ length: 20 }, (_, i) => ({
    type: "pcb_trace_error",
    message: `unresolved error ${i}`,
    center: { x: 100, y: 150 },
  }))
  const run = (
    enableBroadFallback: boolean,
    enableLargeBoardBroadFallback: boolean,
  ): GlobalDrcForceImproveSolver => {
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes: structuredClone(hdRoutes),
      maxIterations: 32,
      enableBroadFallback,
      enableLargeBoardBroadFallback,
      enablePostSolveClearanceRelaxation: false,
      drcEvaluator: () => errors,
    })
    solver.solve()
    return solver
  }
  const enabled = run(true, true)
  const disabled = run(false, true)
  const disabledLargeBoard = run(true, false)
  expect(enabled.solved).toBe(true)
  expect(disabled.solved).toBe(true)
  expect(disabled.iterations).toBeLessThan(enabled.iterations)
  expect(disabled.iterations).toBeLessThan(32)
  expect(disabled.getOutput()).toEqual(enabled.getOutput())
  expect(disabled.stats.finalDrcIssueCount).toBe(20)
  expect(disabledLargeBoard.iterations).toBe(disabled.iterations)
  expect(disabledLargeBoard.getOutput()).toEqual(disabled.getOutput())
})
