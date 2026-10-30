import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import { createPeerTraceRepairInput } from "./fixtures/peerTraceRepair"

test("prepared checks retain contacts on an unchanged fragment of a moved connection", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  hdRoutes.push({
    ...structuredClone(hdRoutes[0]!),
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 3, y: -2, z: 0 },
    ],
  })
  for (let index = 0; index < 7; index++) {
    hdRoutes.push({
      ...structuredClone(hdRoutes[0]!),
      connectionName: `far_${index}`,
      route: [
        { x: 0, y: 4 + index, z: 0 },
        { x: 3, y: 4 + index, z: 0 },
      ],
    })
  }
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const reference = structuredClone(hdRoutes)
  reference[0]!.route[1]!.y = 0.8
  const expected = guard.getNewContactPairs(reference)
  expect(expected.length).toBeGreaterThan(0)
  const check = guard.prepareCandidateCheck(reference)
  const candidate = structuredClone(reference)
  candidate[4]!.route[0]!.x = -0.5
  expect(check(candidate)).toEqual(expected)
})
