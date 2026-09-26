import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"
import input from "./fixtures/srj18-sample9-repair-input.json"

test("repairs SRJ18 sample 9 with original pads and safe layer transitions", async () => {
  const { srj, hdRoutes } = structuredClone(input) as {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const engine = new AutoroutingDrcEngine(srj, {
    connMap,
    includeTraceViaOwnerMetadata: true,
  })
  expect(
    getDrcSnapshot(srj, hdRoutes, undefined, connMap, engine).errors,
  ).toHaveLength(8)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    connMap,
    autoroutingDrcEngine: engine,
    maxIterations: 32,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: false,
    enableTraceViaOwnerTargeting: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })
  // Before the fix, plateau detection stopped this fixture at iteration 13
  // with untried layer variants and one remaining trace-to-via violation.
  for (let iteration = 0; iteration < 13; iteration++) solver.step()
  expect(solver.solved).toBe(false)
  const previousStopRoutes = structuredClone(solver.getOutput())
  const previousStopSnapshot = getDrcSnapshot(
    srj,
    previousStopRoutes,
    undefined,
    connMap,
    engine,
  )
  expect(previousStopSnapshot.errors).toHaveLength(1)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const finalSnapshot = getDrcSnapshot(
    srj,
    solver.getOutput(),
    undefined,
    connMap,
    engine,
  )
  expect(finalSnapshot.errors).toEqual([])
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expectSrjRepairSnapshot(srj, hdRoutes, solver.getOutput(), snapshotPath)
  const affectedRouteIndexes = (
    previousStopSnapshot.errors[0]!.pcb_trace_ids as string[]
  ).map((id) => previousStopSnapshot.traceRouteIndexById.get(id)!)
  expect(affectedRouteIndexes).toHaveLength(2)
  for (const index of affectedRouteIndexes) expect(index).toBeDefined()
  const affectedNames = new Set(
    affectedRouteIndexes.map(
      (index) => previousStopRoutes[index]!.connectionName,
    ),
  )
  const points = [previousStopRoutes, solver.getOutput()].flatMap((routes) =>
    affectedRouteIndexes.flatMap((index) => routes[index]!.route),
  )
  const bounds = {
    minX: Math.min(...points.map((p) => p.x)) - 0.4,
    maxX: Math.max(...points.map((p) => p.x)) + 0.4,
    minY: Math.min(...points.map((p) => p.y)) - 0.4,
    maxY: Math.max(...points.map((p) => p.y)) + 0.4,
  }
  const panels = [previousStopRoutes, solver.getOutput()].map((routes) => {
    const visualizer = new VisualizedGlobalDrcForceImproveSolver({
      srj,
      hdRoutes: previousStopRoutes,
      connMap,
      autoroutingDrcEngine: engine,
    })
    visualizer.outputHdRoutes = routes
    const graphics = visualizer.visualize()
    return {
      ...graphics,
      points: [],
      lines: graphics.lines!.filter((line) =>
        [...affectedNames].some((name) => line.label?.startsWith(`${name} z`)),
      ),
      circles: graphics.circles!.filter(
        (circle) =>
          [...affectedNames].some((name) => circle.label === `${name} via`) ||
          circle.label?.startsWith("unfixed:") ||
          circle.label?.startsWith("fixed:"),
      ),
      rects: [
        ...graphics.rects!.filter(
          (rect) =>
            rect.label !== "board bounds" &&
            rect.center.x - rect.width / 2 >= bounds.minX &&
            rect.center.x + rect.width / 2 <= bounds.maxX &&
            rect.center.y - rect.height / 2 >= bounds.minY &&
            rect.center.y + rect.height / 2 <= bounds.maxY,
        ),
        {
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          fill: "transparent",
          stroke: "#cbd5e1",
        },
      ],
    }
  })
  const svg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(panels, {
      titles: [
        `Previous stop: ${previousStopSnapshot.errors.length} DRC error`,
        `Completed search: ${finalSnapshot.errors.length} DRC errors`,
      ],
    }),
    { backgroundColor: "white", svgWidth: 1400, svgHeight: 800 },
  ).replace(/[ \t]+$/gm, "")
  await expect(svg).toMatchSvgSnapshot(import.meta.path, "plateau-repair")
})
