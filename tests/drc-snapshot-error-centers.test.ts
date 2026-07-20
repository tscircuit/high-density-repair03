import { expect, test } from "bun:test"
import type { DrcEvaluator, SimpleRouteJson } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

test("preserves evaluator-provided DRC centers in snapshots", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const rawError = {
    type: "pcb_trace_error",
    message: "Trace gap: 0.05mm, required: 0.1mm",
    pcb_trace_id: "trace_0",
  }
  const evaluator: DrcEvaluator = () => ({
    errors: [rawError],
    errorsWithCenters: [{ ...rawError, center: { x: 4, y: 6 } }],
  })

  const snapshot = getDrcSnapshot(srj, [], evaluator)

  expect(snapshot.count).toBe(1)
  expect(snapshot.errors).toEqual([{ ...rawError, center: { x: 4, y: 6 } }])
})
