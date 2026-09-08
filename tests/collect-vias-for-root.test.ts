import { expect, test } from "bun:test"
import { collectViaNodes } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("collecting one root preserves via identity and observes changed routes", (): void => {
  const routes: HighDensityRoute[] = ["left", "right", "left"].map(
    (rootConnectionName, index): HighDensityRoute => ({
      connectionName: `branch-${index}`,
      rootConnectionName,
      traceThickness: 0.15,
      viaDiameter: 0.4,
      vias: [{ x: index, y: 0 }],
      route: [
        { x: index - 0.5, y: 0, z: 0 },
        { x: index, y: 0, z: 0 },
        { x: index, y: 0, z: 1 },
        { x: index, y: 0, z: 2 },
        { x: index + 0.5, y: 0, z: 2 },
      ],
    }),
  )
  for (const root of ["left", "right", "missing"]) {
    expect(collectViaNodes(routes, 0.3, root)).toEqual(
      collectViaNodes(routes).filter((via) => via.rootConnectionName === root),
    )
  }
  expect(collectViaNodes(routes, 0.3, "left").map((via) => via.routeIndex)).toEqual([
    0, 2,
  ])
  routes[1]!.rootConnectionName = "left"
  routes[0]!.route[1]!.x += 0.1
  routes[0]!.route[2]!.x += 0.1
  routes[0]!.route[3]!.x += 0.1
  expect(collectViaNodes(routes, 0.3, "left")).toEqual(collectViaNodes(routes))
})
