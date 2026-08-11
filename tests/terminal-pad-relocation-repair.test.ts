import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("relocates a trace terminal within its own pad away from a blocker", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: [{ name: "net_a", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["net_a", "pcb_port_a"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.8, y: 0 },
        width: 1.6,
        height: 1,
        connectedTo: ["net_b", "pcb_port_b"],
      },
    ],
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
        { x: -2, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    autoroutingDrcEngine: engine,
    maxIterations: 4,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
  })

  expect(getDrcSnapshot(srj, routes, undefined, undefined, engine).count).toBe(1)
  solver.solve()

  expect(
    getDrcSnapshot(srj, solver.getOutput(), undefined, undefined, engine).count,
  ).toBe(0)
  expect(solver.getOutput()[0]!.route[0]!.x).toBeLessThan(0)
  expect(solver.getOutput()[0]!.route[0]!.pcb_port_id).toBe("pcb_port_a")
})
