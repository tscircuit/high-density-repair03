import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("moves same-root via fragments away from the exact referenced pad", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "shared_net", pointsToConnect: [] },
      { name: "pad_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1.5, y: 0 },
        width: 0.2,
        height: 0.8,
        connectedTo: ["pcb_smtpad_decoy", "pcb_smtpad_target", "pad_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_decoy" },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.3, y: 0 },
        width: 0.2,
        height: 0.8,
        connectedTo: ["pcb_smtpad_target", "pcb_smtpad_decoy", "pad_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_target" },
      },
    ] as unknown as SimpleRouteJson["obstacles"],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
  }
  const inputRoutes: HighDensityRoute[] = [
    {
      connectionName: "shared_net",
      route: [
        { x: -1, y: 1, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        { x: -1, y: -1, z: 0 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "shared_net",
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
        { x: -1, y: -0.5, z: 2 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    autoroutingDrcEngine: engine,
    maxIterations: 16,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  expect(
    getDrcSnapshot(srj, inputRoutes, undefined, undefined, engine).count,
  ).toBe(2)

  solver.solve()

  const outputRoutes = solver.getOutput()
  expect(
    getDrcSnapshot(srj, outputRoutes, undefined, undefined, engine).errors,
  ).toEqual([])
  expect(outputRoutes.map((route) => route.traceThickness)).toEqual([0.1, 0.1])
  expect(
    outputRoutes.map((route) => [route.route[0], route.route.at(-1)]),
  ).toEqual(inputRoutes.map((route) => [route.route[0], route.route.at(-1)]))
  expect(outputRoutes[0]!.vias[0]).toEqual(outputRoutes[1]!.vias[0])
  expect(outputRoutes[0]!.vias[0]).not.toEqual({ x: 0, y: 0 })
})
