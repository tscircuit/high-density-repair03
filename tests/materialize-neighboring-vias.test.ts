import { expect, test } from "bun:test"
import { materializeRoutes } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../types/high-density-types"

test("materializing routes preserves distinct nearby layer transitions", (): void => {
  const route: HighDensityRoute = {
    connectionName: "multilayer-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 5 },
      { x: 0.0005, y: 0.0005, z: 5 },
      { x: 0.0005, y: 0.0005, z: 2 },
      { x: 0.0005, y: 0.0005, z: 3 },
      { x: 1, y: 0, z: 3 },
    ],
    vias: [],
  }
  const output = materializeRoutes([route])[0]!
  expect(output.route).toEqual(route.route)
  expect(output.vias).toEqual([
    { x: 0, y: 0 },
    { x: 0.0005, y: 0.0005 },
  ])
  for (let index = 1; index < output.route.length; index += 1) {
    const before = output.route[index - 1]!
    const after = output.route[index]!
    if (before.z === after.z) continue
    expect(output.vias).toContainEqual({ x: after.x, y: after.y })
  }
})
