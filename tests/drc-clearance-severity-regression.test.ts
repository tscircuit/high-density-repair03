import { expect, test } from "bun:test"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("scores clearance and minimum DRC messages by their shortfall", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const snapshot = getDrcSnapshot(srj, [], () => [
    {
      message:
        "Pad pcb_port_1 and trace trace_1 are too close (clearance: 0.058mm, minimum: 0.1mm)",
    },
  ])

  expect(snapshot.issueScore).toBeCloseTo(0.042)
  expect(snapshot.maxIssueSeverity).toBeCloseTo(0.042)
})
