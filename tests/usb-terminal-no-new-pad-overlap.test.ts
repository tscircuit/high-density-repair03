import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getDrcSnapshot,
  hasNewTraceObstacleOverlaps,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getUsbCircuitRender } from "./fixtures/getUsbCircuitRender"

test("USB portfolio finishes all phases without publishing new pad overlaps", async () => {
  const { phases, circuitJson } = await getUsbCircuitRender()
  expect(phases).toHaveLength(6)
  expect(phases.every((phase) => phase.solved)).toBe(true)
  expect(
    circuitJson.filter((element) => element.type === "pcb_autorouting_error"),
  ).toHaveLength(0)
  const repairs = phases.flatMap((phase) => phase.repairs)
  expect(repairs.length).toBeGreaterThan(0)
  for (const repair of repairs) {
    const connMap = new ConnectivityMap(repair.netMap)
    const inputSnapshot = getDrcSnapshot(
      repair.srj,
      repair.input,
      undefined,
      connMap,
    )
    const outputSnapshot = getDrcSnapshot(
      repair.srj,
      repair.output,
      undefined,
      connMap,
    )
    expect(hasNewTraceObstacleOverlaps(outputSnapshot, inputSnapshot)).toBe(
      false,
    )
    expect(outputSnapshot.count).toBeLessThanOrEqual(inputSnapshot.count)
  }
}, 30_000)
