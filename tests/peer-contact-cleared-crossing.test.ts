import { expect, test } from "bun:test"
import { TraceContactRepairSolver } from "../lib"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPhysicalPeerPairs } from "./fixtures/peerTraceRepair"

test("local repair does not restore a contact cleared by preceding stages", () => {
  const input: HighDensityRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [0, 1, 3, 4].map((x) => ({ x, y: 0, z: 0 })),
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-2, 2].map((y) => ({ x: 2.5, y, z: 0 })),
    },
    {
      connectionName: "c",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-2, -1, 1, 2].map((y) => ({ x: 2, y, z: 1 })),
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -3, maxX: 5, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: input.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const candidate = structuredClone(input)
  candidate[0]!.route.forEach((point) => {
    point.z = 1
  })
  expect(getPhysicalPeerPairs(input)).toEqual(['["a","b"]'])
  expect(getPhysicalPeerPairs(candidate)).toEqual(['["a","c"]'])
  const solver = new TraceContactRepairSolver({
    srj,
    inputHdRoutes: input,
    hdRoutes: candidate,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    drcEvaluator: () => ({ errors: [], errorsWithCenters: [] }),
  })
  solver.solve()
  expect(solver.stats.traceContactRepairAccepted).toBe(true)
  expect(getPhysicalPeerPairs(solver.getOutput())).toEqual([])
})
