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
import { visualizeGlobalDrcForceImproveSolverSteps } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"

const srj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -4, maxX: 4, maxY: 2 },
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
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: -1, z: 1 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: -3, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 1, y: -1 },
    ],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "B",
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
      { x: 3, y: -2, z: 0 },
      { x: 0, y: -2, z: 0 },
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

test("completes a repeated trace-pair repair as one transaction", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes?.[0]
    const routeB = routes?.[1]
    if (!routeA || !routeB) return []

    const firstCrossingMovedToLayerOne =
      routeA.route.filter((point) => point.y === 0 && point.z === 1).length >= 2
    if (!firstCrossingMovedToLayerOne) {
      return [makeTracePairError({ x: 0, y: 0 })]
    }

    const lowerRoutePointMoved = routeA.route.some(
      (point) => point.z === 0 && point.y <= -1 && Math.abs(point.x - 1) > 1e-4,
    )
    const lowerBlockingPoint = routeB.route.find(
      (point) => point.x >= 2.9 && point.y < 0,
    )
    const lowerBlockingPointMoved =
      lowerBlockingPoint !== undefined &&
      Math.abs(lowerBlockingPoint.y + 2) > 1e-4
    if (!lowerRoutePointMoved && !lowerBlockingPointMoved) {
      return [makeTracePairError({ x: 1, y: -2 })]
    }

    return []
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 2,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const repairedRoute = solver.getOutput()[0]!
  expect(solver.getOutput()).not.toEqual(hdRoutes)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(repairedRoute.route[0]).toEqual(hdRoutes[0]!.route[0]!)
  expect(repairedRoute.route.at(-1)).toEqual(hdRoutes[0]!.route.at(-1)!)
  expect(
    solver.stats.globalDrcForceImproveTracePairLayerMoveFollowUpAttempts,
  ).toBe(1)
  expect(
    solver.stats.globalDrcForceImproveTracePairLayerMoveFollowUpsAccepted,
  ).toBe(1)

  const visualization = visualizeGlobalDrcForceImproveSolverSteps(solver, "all")
  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [1, 2, 3].map((step) => getStepGraphics(visualization, step)),
      {
        titles: ["Before repair", "Layer move + follow-up", "After repair"],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/trace-pair-layer-move-follow-up-before-after.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8").trim())
})
