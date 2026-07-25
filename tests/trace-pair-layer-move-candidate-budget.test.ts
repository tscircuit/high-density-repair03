import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import type { DrcEvaluator } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import "../fixture-support/VisualizedGlobalDrcForceImproveSolver"

const srj: SimpleRouteJson = {
  bounds: { minX: -2.5, minY: -2.5, maxX: 2.5, maxY: 2.5 },
  connections: [
    { name: "A", pointsToConnect: [] },
    { name: "B", pointsToConnect: [] },
  ],
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "A",
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "B",
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
]

const makeTracePairError = (center: { x: number; y: number }) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  message: "PCB traces overlap",
  pcb_trace_id: "A_0",
  pcb_trace_error_id: "overlap_A_0_B_0",
  center,
})

const getStepGraphics = (
  graphics: GraphicsObject,
  step: number,
): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.filter((object) => object.step === step),
  lines: graphics.lines?.filter((object) => object.step === step),
  infiniteLines: graphics.infiniteLines?.filter(
    (object) => object.step === step,
  ),
  rects: graphics.rects?.filter((object) => object.step === step),
  polygons: graphics.polygons?.filter((object) => object.step === step),
  circles: graphics.circles?.filter((object) => object.step === step),
  texts: graphics.texts?.filter((object) => object.step === step),
})

test("follow-up repairs do not starve alternate layer-move candidates", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes?.[0]
    const routeB = routes?.[1]
    if (!routeA || !routeB) return []

    const routeAMoved = routeA.route.some((point) => point.z === 1)
    const routeBMoved = routeB.route.some((point) => point.z === 1)

    if (routeBMoved) return []
    if (routeAMoved) return [makeTracePairError({ x: 1, y: 0 })]
    return [makeTracePairError({ x: 0, y: 0 })]
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()[1]?.route.some((point) => point.z === 1)).toBe(true)
  expect(
    solver.stats.globalDrcForceImproveTracePairLayerMoveFollowUpAttempts,
  ).toBeGreaterThan(0)

  const visualization = solver.visualize()
  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        getStepGraphics(visualization, 1),
        getStepGraphics(visualization, 2),
        getStepGraphics(visualization, 3),
      ],
      {
        titles: [
          "Before: trace-pair collision",
          "Alternate layer candidate",
          "After: zero DRC errors",
        ],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/trace-pair-layer-move-candidate-budget-before-after.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
