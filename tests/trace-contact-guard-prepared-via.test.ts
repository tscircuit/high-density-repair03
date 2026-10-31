import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("prepared checks detect via diameter changes and in-place via movement", () => {
  const { srj, hdRoutes } = createViaContactGuardInput()
  for (const point of hdRoutes[1]!.route) point.y = 0.21
  hdRoutes[1]!.vias[0]!.y = 0.21
  for (let index = 0; index < 6; index++) {
    hdRoutes.push({
      ...structuredClone(hdRoutes[0]!),
      connectionName: `stationary_${index}`,
      route: [
        { x: -1, y: 4 + index, z: 0 },
        { x: 1, y: 4 + index, z: 0 },
      ],
    })
  }
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const check = guard.prepareCandidateCheck(hdRoutes)
  const wider = structuredClone(hdRoutes)
  wider[1]!.viaDiameter = 0.4
  expect(check(wider)).toEqual([["via", "wire"]])
  expect(check(wider)).toEqual(guard.getNewContactPairs(wider))
  for (const point of hdRoutes[1]!.route) point.y = 0.19
  hdRoutes[1]!.vias[0]!.y = 0.19
  expect(check(hdRoutes)).toEqual([["via", "wire"]])
  expect(check(hdRoutes)).toEqual(guard.getNewContactPairs(hdRoutes))
})
