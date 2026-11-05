import { expect, test } from "bun:test"
import {
  TraceContactGuard,
  TraceContactRepairSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("the owner moves wire segments in opposite directions around fixed terminal vias", () => {
  const input: HighDensityRoute[] = [
    {
      connectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        [-2, 0],
        [-1, -0.5],
        [-0.25, -0.5],
        [0.25, 0.5],
        [1, 0.5],
        [2, 0],
      ].map(([x, y]) => ({ x: x!, y: y!, z: 0 })),
    },
    {
      connectionName: "vias",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: -0.4, y: 0.19 },
        { x: 0.4, y: -0.19 },
      ],
      route: [
        { x: -0.4, y: 0.19, z: 1 },
        { x: -0.4, y: 0.19, z: 2 },
        { x: 0.4, y: -0.19, z: 2 },
        { x: 0.4, y: -0.19, z: 1 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: input.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const candidate = structuredClone(input)
  for (const point of candidate[0]!.route) point.y = 0
  const original = structuredClone({ input, candidate })
  const guard = new TraceContactGuard({ srj, inputRoutes: input })
  expect(guard.getNewContactPairs(candidate)).toEqual([["vias", "wire"]])
  const solver = new TraceContactRepairSolver({
    srj,
    inputHdRoutes: input,
    hdRoutes: candidate,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  solver.solve()
  const output = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output).not.toEqual(input)
  expect(guard.getNewContactPairs(output)).toEqual([])
  expect(output[1]).toEqual(input[1])
  expect(output[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(getDrcSnapshot(srj, output).count).toBe(0)
  expect({ input, candidate }).toEqual(original)
})
