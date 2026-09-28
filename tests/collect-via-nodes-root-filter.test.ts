import { expect, test } from "bun:test"
import type { HighDensityRoute } from "../lib"
import { collectViaNodes } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("root-filtered via collection preserves global route indexes and site metadata", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "shared_branch_0",
      rootConnectionName: "shared",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 3 },
        { x: 1, y: 0, z: 3 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "foreign_terminal" },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 2, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "shared_branch_1",
      rootConnectionName: "shared",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "shared_terminal" },
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
      ],
      vias: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
    },
    {
      connectionName: "shared",
      traceThickness: 0.1,
      viaDiameter: 0.5,
      route: [
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      vias: [{ x: 3, y: 0 }],
    },
    {
      connectionName: "shared",
      rootConnectionName: "foreign",
      traceThickness: 0.1,
      viaDiameter: 0.7,
      route: [
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 0, z: 1 },
        { x: 6, y: 0, z: 1 },
      ],
      vias: [{ x: 5, y: 0 }],
    },
  ]
  const originalRoutes = structuredClone(routes)
  const allVias = collectViaNodes(routes, 0.8)

  for (const root of ["shared", "foreign", "missing"]) {
    expect(collectViaNodes(routes, 0.8, root)).toEqual(
      allVias.filter((via) => via.rootConnectionName === root),
    )
  }
  const sharedVias = collectViaNodes(routes, 0.8, "shared")
  expect(sharedVias.map((via) => via.routeIndex)).toEqual([0, 2, 2, 3])
  expect(sharedVias[0]).toMatchObject({
    pointIndexes: [1, 2, 3, 4],
    zLayers: [0, 1, 2, 3],
    radius: 0.2,
    movable: true,
    canCanonicalize: true,
  })
  expect(sharedVias[1]).toMatchObject({
    x: 0,
    y: 0,
    movable: false,
    canCanonicalize: false,
  })
  expect(sharedVias[2]).toMatchObject({
    movable: false,
    canCanonicalize: true,
  })
  expect(routes).toEqual(originalRoutes)
})
