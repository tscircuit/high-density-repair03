import { expect, test } from "bun:test"
import "bun-match-svg"
import { getUsbCircuitRender } from "./fixtures/getUsbCircuitRender"
import { getTerminalViaGaps } from "./fixtures/getTerminalViaGaps"

test("honors terminal-via clearance on a routed USB-C power circuit", async () => {
  const { circuitJson, svg, phases } = await getUsbCircuitRender()
  expect(phases).toHaveLength(6)
  expect(phases.every((phase) => phase.solved)).toBe(true)
  const repairs = phases.flatMap((phase) => phase.repairs)
  expect(
    repairs.some(
      (repair) => repair.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted,
    ),
  ).toBe(true)
  expect(
    repairs.every(
      (repair) => !repair.stats.drcBranchPortfolioViaInPadPhaseAttempted,
    ),
  ).toBe(true)
  for (const repair of repairs) {
    expect(repair.srj.minViaEdgeToPadEdgeClearance).toBe(0.1)
    for (const input of repair.input) {
      const output = repair.output.find(
        (route) => route.connectionName === input.connectionName,
      )!
      expect(output.route[0]).toEqual(input.route[0])
      expect(output.route.at(-1)).toEqual(input.route.at(-1))
    }
  }
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(5)
  expect(
    circuitJson.filter((element) => element.type === "source_trace"),
  ).toHaveLength(6)
  expect(
    circuitJson.filter((element) => element.type === "pcb_trace").length,
  ).toBeGreaterThan(5)
  // Measure the final native copper, not just the router's DRC count.
  for (const gapMm of getTerminalViaGaps(circuitJson)) {
    expect(gapMm).toBeGreaterThanOrEqual(0.1)
    expect(gapMm).toBeLessThan(0.10001)
  }
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
