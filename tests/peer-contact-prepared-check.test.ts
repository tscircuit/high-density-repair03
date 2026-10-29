import { expect, test } from "bun:test"
import { TraceContactGuard } from "../lib"
import {
  createPeerTraceRepairInput,
  getPhysicalPeerPairs,
} from "./fixtures/peerTraceRepair"

test("prepared contact checks match exhaustive geometry across local proposals", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  for (let index = 0; index < 8; index++) {
    hdRoutes.push({
      connectionName: `stationary_${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 4 + index, z: 0 },
        { x: 4, y: 4 + index, z: 0 },
      ],
    })
  }
  const guard = new TraceContactGuard({ srj, inputRoutes: hdRoutes })
  const reference = structuredClone(hdRoutes)
  const check = guard.prepareCandidateCheck(reference)
  const baseline = new Set(getPhysicalPeerPairs(hdRoutes))
  let seed = 123456789
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 200; trial++) {
    const candidate = structuredClone(reference)
    for (let change = 0; change < 2; change++) {
      const route = candidate[Math.floor(random() * 4)]!
      route.route[1]!.x += random() - 0.5
      route.route[1]!.y += random() * 2 - 1
      if (trial % 7 === 0) route.traceThickness = 0.25
      if (trial % 11 === 0)
        route.route[0]!.toNextSegmentType = "through_obstacle"
      if (trial % 13 === 0)
        route.route.forEach((point) => {
          point.z = 1
        })
    }
    const expected = getPhysicalPeerPairs(candidate).filter(
      (pair) => !baseline.has(pair),
    )
    expect(
      check(candidate)
        .map((pair) => JSON.stringify(pair))
        .sort(),
    ).toEqual(expected)
  }
  reference[0]!.route[1]!.y = 0.8
  expect(
    check(reference)
      .map((pair) => JSON.stringify(pair))
      .sort(),
  ).toEqual(
    getPhysicalPeerPairs(reference).filter((pair) => !baseline.has(pair)),
  )
})
