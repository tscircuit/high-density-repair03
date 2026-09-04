import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "../lib"
import {
  getRepairDrcIssueScore,
  getTopologyRepairDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("via-pad errors do not discard quantitative trace repair progress", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
  }
  for (const worstClearance of [-0.1, -0.03, 0.08]) {
    const snapshot = getTopologyRepairDrcSnapshot(srj, [], () => ({
      errors: [
        {
          type: "pcb_trace_error",
          message: "PCB traces overlap (accidental contact)",
          minimum_clearance: 0.1,
          worst_actual_clearance: worstClearance,
          center: { x: 0, y: 0 },
        },
        {
          type: "pcb_pad_pad_clearance_error",
          pcb_via_ids: ["via_0"],
          minimum_clearance: 0.1,
          worst_actual_clearance: 0.075,
          center: { x: 0.5, y: 0.5 },
        },
      ],
    }))
    expect(snapshot.count).toBe(2)
    expect(getRepairDrcIssueScore(snapshot)).toBeCloseTo(0.1 - worstClearance)
  }
})
