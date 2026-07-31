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
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  connections: [
    { name: "A", pointsToConnect: [] },
    { name: "B", pointsToConnect: [] },
  ],
  obstacles: [],
  layerCount: 4,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "A",
    route: [
      { x: -1, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "B",
    route: [
      { x: 0, y: -1, z: 1 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
]

const tracePairError = {
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  message: "PCB traces overlap",
  pcb_trace_id: "A_0",
  pcb_trace_error_id: "overlap_A_0_B_0",
  center: { x: 0, y: 0 },
}

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

test("repairs a trace pair without enabling via-in-pad moves", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const movedToAnotherLayer = routes?.some((route) =>
      route.route.some((point) => point.z !== 1),
    )
    return movedToAnotherLayer ? [] : [tracePairError]
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputHdRoutes = solver.getOutput()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(outputHdRoutes.flatMap((route) => route.vias)).toHaveLength(2)
  expect(
    outputHdRoutes.some((route) => route.route.some((point) => point.z !== 1)),
  ).toBe(true)

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
          "Before: colliding traces",
          "Trace-pair layer move",
          "After: zero DRC errors",
        ],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/trace-pair-repair-with-via-in-pad-disabled.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8").trimEnd())
})
