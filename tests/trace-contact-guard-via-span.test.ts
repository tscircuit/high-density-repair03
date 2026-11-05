import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("via contacts follow the physical through or opted-in partial drill span", () => {
  for (const allowBlindAndBuriedVias of [false, true]) {
    for (const reversed of [false, true]) {
      const { srj, hdRoutes } = createViaContactGuardInput()
      srj.allowBlindAndBuriedVias = allowBlindAndBuriedVias
      if (reversed) hdRoutes[1]!.route.reverse()
      const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
      const candidate = structuredClone(hdRoutes)
      for (const point of candidate[1]!.route) point.y = 0.19
      candidate[1]!.vias[0]!.y = 0.19
      expect(guard.getNewContactPairs(candidate)).toEqual(
        allowBlindAndBuriedVias ? [] : [["via", "wire"]],
      )
      for (const point of candidate[0]!.route) point.z = 1
      expect(guard.getNewContactPairs(candidate)).toEqual([["via", "wire"]])
    }
  }
})
