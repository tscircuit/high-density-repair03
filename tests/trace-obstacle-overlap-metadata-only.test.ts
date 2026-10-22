import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("structured trace-obstacle IDs identify raw-only and enriched contacts without prose", () => {
  const before = snapshot([])
  for (const obstacleKey of [
    "pcb_pad_id",
    "pcb_smtpad_id",
    "pcb_plated_hole_id",
    "pcb_hole_id",
    "pcb_keepout_id",
    "pcb_obstacle_id",
  ]) {
    const contact = {
      type: "pcb_trace_error",
      pcb_trace_id: "trace_0",
      [obstacleKey]: "foreign_obstacle",
      actual_clearance: -0.04,
      message: "(accidental contact)",
    }
    const rawOnly = { ...snapshot([]), rawErrors: [contact], count: 1 }
    const enrichedOnly = {
      ...snapshot([{ ...contact, worst_actual_clearance: -0.04 }]),
      rawErrors: [{ ...contact, actual_clearance: 0.04 }],
    }
    expect(hasNewTraceObstacleOverlaps(rawOnly, before)).toBe(true)
    expect(hasNewTraceObstacleOverlaps(enrichedOnly, before)).toBe(true)
    expect(hasNewTraceObstacleOverlaps(enrichedOnly, rawOnly)).toBe(false)
    expect(
      hasNewTraceObstacleOverlaps(
        snapshot([{ ...contact, actual_clearance: 0.04 }]),
        before,
      ),
    ).toBe(false)
  }
  expect(
    hasNewTraceObstacleOverlaps(
      snapshot([
        {
          type: "pcb_trace_error",
          pcb_trace_id: "trace_0",
          pcb_via_id: "via_0",
          actual_clearance: -0.04,
          message: "(accidental contact)",
        },
      ]),
      before,
    ),
  ).toBe(false)
})
