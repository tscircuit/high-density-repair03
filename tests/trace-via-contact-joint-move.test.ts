import { expect, test } from "bun:test"
import {
  TraceContactGuard,
  TraceContactRepairSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("the final owner repairs two annulus contacts in one pair without reverting the connections", () => {
  const input: HighDensityRoute[] = [
    {
      connectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "vias",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: 0.8, y: 1 },
        { x: 2.2, y: 1 },
      ],
      route: [
        { x: 0, y: 0.5, z: 1 },
        { x: 0.8, y: 1, z: 1 },
        { x: 0.8, y: 1, z: 0 },
        { x: 2.2, y: 1, z: 0 },
        { x: 2.2, y: 1, z: 1 },
        { x: 3, y: 0.5, z: 1 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 4, maxY: 2 },
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
  for (const point of candidate[1]!.route.slice(1, -1)) point.y = 0.19
  for (const via of candidate[1]!.vias) via.y = 0.19
  const original = structuredClone({ input, candidate })
  const guard = new TraceContactGuard({ srj, inputRoutes: input })
  expect(guard.getNewContactPairs(candidate)).toEqual([["vias", "wire"]])
  const owner = new TraceContactRepairSolver({
    srj,
    inputHdRoutes: input,
    hdRoutes: candidate,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  owner.solve()
  const output = owner.getOutput()
  expect(owner.solved).toBe(true)
  expect(owner.failed).toBe(false)
  expect(owner.stats.traceContactRepairAccepted).toBe(true)
  expect(output).not.toEqual(input)
  expect(guard.getNewContactPairs(output)).toEqual([])
  expect(getDrcSnapshot(srj, output).count).toBe(0)
  expect(output[1]!.route[0]).toEqual(input[1]!.route[0])
  expect(output[1]!.route.at(-1)).toEqual(input[1]!.route.at(-1))
  expect({ input, candidate }).toEqual(original)
})
