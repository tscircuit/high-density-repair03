import { expect, test } from "bun:test"
import type { HighDensityRoute } from "../lib"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { createPeerTraceRepairInput } from "./fixtures/peerTraceRepair"

test("peer contacts use actual wire width and layer without a clearance tolerance", () => {
  const { srj, hdRoutes } = createPeerTraceRepairInput()
  const input: HighDensityRoute[] = hdRoutes.slice(0, 2).map((route, i) => ({
    ...route,
    traceThickness: i === 0 ? 0.4 : 0.2,
    route: [
      { x: 0, y: i, z: 0 },
      { x: 2, y: i, z: 0 },
    ],
  }))
  const guard = new TraceContactGuard({ srj, inputRoutes: input })
  for (const gap of [-0.002, -0.000001, 0, 0.01]) {
    const candidate: HighDensityRoute[] = structuredClone(input)
    candidate[1]!.route.forEach((point) => {
      point.y = 0.3 + gap
    })
    expect(guard.getNewContactConnectionNames(candidate).size).toBe(
      gap < 0 ? 2 : 0,
    )
  }
  const crossing = structuredClone(input)
  crossing[1]!.route = [
    { x: 1, y: -1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ]
  expect(guard.getNewContactConnectionNames(crossing).size).toBe(2)
  crossing[1]!.route.forEach((point) => {
    point.z = 1
  })
  expect(guard.getNewContactConnectionNames(crossing).size).toBe(0)
  crossing[1]!.route.forEach((point) => {
    point.z = 0
  })
  crossing[1]!.route[0]!.toNextSegmentType = "through_obstacle"
  expect(guard.getNewContactConnectionNames(crossing).size).toBe(0)
})
