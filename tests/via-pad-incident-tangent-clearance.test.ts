import { expect, test } from "bun:test"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"

test("tries an incident route tangent when direct via-pad repulsion is blocked", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "pad_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.2, y: -0.2 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign", "pad_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "via_net",
      route: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const via = routes?.[0]?.route[1]
    if (!via) throw new Error("Expected the test route to contain a via")
    if (via.x >= 0.08 && Math.abs(via.y) <= 1e-6) return []
    if (via.y > 1e-6) {
      return [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "blocking_trace_0",
          center: { x: via.x, y: via.y },
          message: "Direct pad repulsion moves the via into a blocking trace",
        },
      ]
    }
    return [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_pad_pad_clearance_error_id:
          "via_pad_clearance_via_0_pcb_smtpad_foreign",
        pcb_trace_id: "via_net_0",
        pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
        pcb_via_ids: ["via_0"],
        center: { x: -0.1, y: -0.1 },
        message:
          'pcb_via "via_0" and pcb_smtpad "pcb_smtpad_foreign" are too close',
      },
    ]
  }
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    viaInPadDrcEvaluator: drcEvaluator,
    maxIterations: 4,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    viaInPadMaxIterations: 4,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputVia = solver.getOutput()[0]?.route[1]
  expect(outputVia).toMatchObject({ x: 0.14, y: 0 })
  expect(drcEvaluator({ traces: [], routes: solver.getOutput() })).toEqual([])
  expect(solver.stats).toMatchObject({
    finalDrcIssueCount: 0,
    drcBranchPortfolioViaInPadPhaseAttempted: true,
    drcBranchPortfolioBroadBranchAttempted: false,
  })
})
