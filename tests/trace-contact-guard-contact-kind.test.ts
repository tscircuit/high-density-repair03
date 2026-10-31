import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("an existing annulus contact does not excuse a new wire crossing between the same connections", () => {
  const { srj, hdRoutes } = createViaContactGuardInput()
  for (const point of hdRoutes[1]!.route) point.y = 0.19
  hdRoutes[1]!.vias[0]!.y = 0.19
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const check = guard.prepareCandidateCheck(hdRoutes)
  expect(guard.getNewContactPairs(hdRoutes)).toEqual([])
  const candidate = structuredClone(hdRoutes)
  candidate[1]!.route.push({ x: 1, y: 0.19, z: 0 }, { x: -0.5, y: 0, z: 0 })
  candidate[1]!.vias.push({ x: 1, y: 0.19 })
  expect(guard.getNewWireContactPairs(candidate)).toEqual([["via", "wire"]])
  expect(guard.getNewContactPairs(candidate)).toEqual([["via", "wire"]])
  expect(check(candidate)).toEqual([["via", "wire"]])
})
