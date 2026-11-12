import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

test("keeps a shared via fixed when one copy is a route terminal", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "terminal-route",
      rootConnectionName: "ground",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 1, z: 1 },
      ],
    },
    {
      connectionName: "movable-route",
      rootConnectionName: "ground",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: -1, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0.5, z: 1 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: [
      {
        type: "rect",
        center: { x: 0.55, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign", "foreign"],
      },
    ],
    connections: [
      {
        name: "terminal-route",
        rootConnectionName: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: -1, y: 1, layer: "bottom" },
        ],
      },
      {
        name: "movable-route",
        rootConnectionName: "ground",
        pointsToConnect: [
          { x: -1, y: -1, layer: "top" },
          { x: -1, y: 0.5, layer: "bottom" },
        ],
      },
    ],
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: structuredClone(routes),
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.initialDrcIssueCount).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
  expect(solver.getOutput()).toEqual(routes)
})
