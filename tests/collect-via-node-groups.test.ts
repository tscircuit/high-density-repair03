import { expect, test } from "bun:test"
import { collectViaNodes } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { COORDINATE_EPSILON } from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("collects terminal and repeated via groups without changing route inputs", () => {
  const epsilon = COORDINATE_EPSILON
  const routes: HighDensityRoute[] = [
    {
      connectionName: "terminal-and-interior",
      rootConnectionName: "root-terminal",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [],
      route: [
        { x: 0, y: 0, z: 1, pcb_port_id: "start" },
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
        { x: 2, y: 0, z: 3 },
        { x: 3, y: 0, z: 3, pcb_port_id: "end" },
      ],
    },
    {
      connectionName: "untagged-terminal",
      traceThickness: 0.15,
      viaDiameter: 0.4,
      vias: [],
      route: [
        { x: -4, y: 2, z: 2 },
        { x: -4, y: 2, z: 3 },
        { x: -3, y: 2, z: 3 },
      ],
    },
    {
      connectionName: "epsilon-overlap",
      rootConnectionName: "root-epsilon",
      traceThickness: 0.15,
      viaDiameter: 0.5,
      vias: [],
      // The second transition overlaps the first group only through earlier
      // points; its initial pair alone would appear to be a separate via.
      route: [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 4, z: 1 },
        { x: 2 * epsilon, y: 4, z: 1 },
        { x: epsilon, y: 4, z: 1 },
        { x: epsilon, y: 4, z: 2 },
        { x: 1, y: 4, z: 2 },
      ],
    },
    {
      connectionName: "no-vias",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.45,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles: [],
  }
  const originalRoutes = structuredClone(routes)
  const originalSrj = structuredClone(srj)
  const expected = [
    {
      routeIndex: 0,
      rootConnectionName: "root-terminal",
      pointIndexes: [0, 1, 2],
      zLayers: [0, 1, 2, 3],
      x: 0,
      y: 0,
      radius: 0.3,
      movable: false,
      canCanonicalize: false,
    },
    {
      routeIndex: 0,
      rootConnectionName: "root-terminal",
      pointIndexes: [4, 5, 6],
      zLayers: [0, 1, 2, 3],
      x: 2,
      y: 0,
      radius: 0.3,
      movable: true,
      canCanonicalize: true,
    },
    {
      routeIndex: 1,
      rootConnectionName: "untagged-terminal",
      pointIndexes: [0, 1],
      zLayers: [0, 1, 2, 3],
      x: -4,
      y: 2,
      radius: 0.2,
      movable: false,
      canCanonicalize: true,
    },
    {
      routeIndex: 2,
      rootConnectionName: "root-epsilon",
      pointIndexes: [0, 1],
      zLayers: [0, 1, 2, 3],
      x: 0,
      y: 4,
      radius: 0.25,
      movable: false,
      canCanonicalize: true,
    },
  ]

  expect(collectViaNodes(routes, srj)).toEqual(expected)
  expect(
    collectViaNodes(routes, { ...srj, allowBlindAndBuriedVias: true }),
  ).toEqual([
    { ...expected[0]!, zLayers: [1, 2] },
    { ...expected[1]!, zLayers: [1, 2, 3] },
    { ...expected[2]!, zLayers: [2, 3] },
    { ...expected[3]!, zLayers: [0, 1] },
  ])
  expect(collectViaNodes([], srj)).toEqual([])
  expect(routes).toEqual(originalRoutes)
  expect(srj).toEqual(originalSrj)
})
