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
  bounds: { minX: -2.5, minY: -1.5, maxX: 2.5, maxY: 1.5 },
  connections: [
    { name: "A", pointsToConnect: [] },
    { name: "B", pointsToConnect: [] },
  ],
  obstacles: [
    {
      type: "rect",
      obstacleId: "foreign_pad",
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["B", "foreign_pad"],
    },
  ],
  layerCount: 1,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.1,
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
]

const segmentIntersectsBox = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  box: { left: number; right: number; bottom: number; top: number },
) => {
  let minimumT = 0
  let maximumT = 1
  for (const [startValue, delta, minimum, maximum] of [
    [start.x, end.x - start.x, box.left, box.right],
    [start.y, end.y - start.y, box.bottom, box.top],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (startValue < minimum || startValue > maximum) return false
      continue
    }
    const firstT = (minimum - startValue) / delta
    const secondT = (maximum - startValue) / delta
    minimumT = Math.max(minimumT, Math.min(firstT, secondT))
    maximumT = Math.min(maximumT, Math.max(firstT, secondT))
    if (minimumT > maximumT) return false
  }
  return true
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

test("routes a same-layer trace around a pad clearance envelope", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const route = routes?.[0]?.route ?? []
    const clearanceBox = {
      left: -0.45,
      right: 0.45,
      bottom: -0.45,
      top: 0.45,
    }
    const intersectsPadClearance = route.some((start, index) => {
      const end = route[index + 1]
      return end ? segmentIntersectsBox(start, end, clearanceBox) : false
    })
    if (!intersectsPadClearance) return []

    return [
      {
        type: "pcb_pad_trace_clearance_error",
        error_type: "pcb_pad_trace_clearance_error",
        pcb_pad_trace_clearance_error_id: "pad_trace_clearance_foreign_pad_A_0",
        pcb_pad_id: "foreign_pad",
        pcb_trace_id: "A_0",
        message: "Trace A is too close to foreign_pad",
        minimum_clearance: 0.1,
        center: { x: 0, y: 0 },
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
    solver.getOutput()[0]?.route.some((point) => Math.abs(point.y) > 0.45),
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
          "Before: trace crosses clearance",
          "Scored pad detour",
          "After: zero DRC errors",
        ],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/pad-trace-detour-before-after.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
