import { expect, test } from "bun:test"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { expectSnapshot } from "./fixtures/rv1106-phased-repair/expectSnapshot"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { type HighDensityRoute, type SimpleRouteJson } from "../lib"
test("repairs a crossing while terminal-locked same-net vias remain", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: ["a", "b", "v1", "v2"].map((name) => ({
      name,
      pointsToConnect: [],
    })),
    obstacles: [],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "a",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "b",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "v1",
      route: [
        { x: 3, y: 0, z: 0, pcb_port_id: "terminal_a" },
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      vias: [{ x: 3, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "v2",
      route: [
        { x: 3.15, y: 0, z: 0, pcb_port_id: "terminal_b" },
        { x: 3.15, y: 0, z: 1 },
        { x: 4, y: 0.15, z: 1 },
      ],
      vias: [{ x: 3.15, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["v1", "v2"]])
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    maxIterations: 8,
    enableTargetedErrorSweep: true,
    enableSafeTraceLayerMoves: true,
    enableBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  expect(solver.stats.initialDrcIssueCount).toBe(2)
  expect(solver.stats.finalDrcIssueCount).toBe(1)
  expect(solver.getOutput().slice(2)).toEqual(hdRoutes.slice(2))
  for (const [index, route] of solver.getOutput().entries()) {
    expect(route.route[0]).toEqual(hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(hdRoutes[index]!.route.at(-1))
  }
  expectSnapshot({
    graphics: solver.visualize(),
    name: "terminal-via-trace-topology",
  })
})
