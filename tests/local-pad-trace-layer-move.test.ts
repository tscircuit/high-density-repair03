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
  bounds: { minX: -0.5, minY: -1.5, maxX: 4.5, maxY: 1.5 },
  connections: [
    { name: "A", pointsToConnect: [] },
    { name: "B", pointsToConnect: [] },
  ],
  obstacles: [
    {
      type: "rect",
      obstacleId: "foreign_top_pad",
      center: { x: 2, y: 0 },
      width: 0.7,
      height: 0.7,
      layers: ["top"],
      connectedTo: ["B"],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "A",
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
]

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

test("moves an interior trace run to clear a foreign-layer pad", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const route = routes?.[0]?.route ?? []
    const hasTopSegmentThroughPad = route.some((start, index) => {
      const end = route[index + 1]
      if (!end || start.z !== 0 || end.z !== 0) return false
      return Math.min(start.x, end.x) <= 2 && Math.max(start.x, end.x) >= 2
    })
    if (!hasTopSegmentThroughPad) return []

    return [
      {
        type: "pcb_pad_trace_clearance_error",
        error_type: "pcb_pad_trace_clearance_error",
        pcb_pad_trace_clearance_error_id:
          "pad_trace_clearance_foreign_top_pad_A_0",
        pcb_pad_id: "foreign_top_pad",
        pcb_trace_id: "A_0",
        message: "Top trace is too close to foreign_top_pad",
        center: { x: 2, y: 0 },
      },
    ]
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
  expect(
    solver
      .getOutput()[0]
      ?.route.some((point) => point.x === 2 && point.z === 0),
  ).toBe(false)

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
          "Before: top trace at pad",
          "Interior run moved",
          "After: zero DRC errors",
        ],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/local-pad-trace-layer-move-before-after.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
