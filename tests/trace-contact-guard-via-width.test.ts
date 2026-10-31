import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("via contact uses its physical diameter without excusing small overlaps", () => {
  const { srj, hdRoutes } = createViaContactGuardInput()
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  for (const gap of [-0.002, -0.000001, 0, 0.01]) {
    const candidate = structuredClone(hdRoutes)
    for (const point of candidate[1]!.route) point.y = 0.2 + gap
    candidate[1]!.vias[0]!.y = 0.2 + gap
    expect(guard.getNewContactPairs(candidate)).toEqual(
      gap < 0 ? [["via", "wire"]] : [],
    )
    expect(guard.getNewWireContactPairs(candidate)).toEqual([])
  }
})
