import { expect, test } from "bun:test"
import { hasNewTraceObstacleOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { padError, snapshot } from "./fixtures/traceObstacleOverlapFixtures"

test("stable obstacle metadata identifies contacts while opaque IDs alone do not", () => {
  const before = snapshot([
    padError({
      pad: "pad_a",
      clearance: -0.04,
    }),
  ])
  const structured = snapshot([
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_trace_clearance_error_id: "regenerated_error",
      pcb_trace_id: "trace_0",
      pcb_pad_id: "pad_a",
      actual_clearance: -0.03,
    },
  ])
  const readable = snapshot([
    padError({
      pad: "pad_a",
      clearance: -0.03,
      message: 'PCB trace trace_0 overlaps with pcb_smtpad "J1.pin1[#pad_a]"',
    }),
  ])
  expect(hasNewTraceObstacleOverlaps(structured, before)).toBe(false)
  expect(hasNewTraceObstacleOverlaps(readable, before)).toBe(false)

  const unidentified = snapshot([
    padError({
      pad: "pad_a",
      clearance: -0.03,
      pcb_trace_error_id: "opaque_id",
      message: "PCB trace overlaps with pcb_smtpad (accidental contact)",
    }),
  ])
  // The same opaque error ID cannot establish that the obstacle is unchanged.
  expect(hasNewTraceObstacleOverlaps(unidentified, unidentified)).toBe(true)
})
