import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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
import "../fixture-support/VisualizedGlobalDrcForceImproveSolver"

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

test("detours a locked terminal trace around its exact collision", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1.5, minY: -0.8, maxX: 1.5, maxY: 0.8 },
    connections: [
      {
        name: "locked_horizontal",
        pointsToConnect: [
          { x: -1, y: 0.193, layer: "top", pcb_port_id: "left" },
          { x: 1, y: 0.193, layer: "top", pcb_port_id: "right" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -0.5, layer: "top", pcb_port_id: "bottom" },
          { x: 0, y: 0.1, layer: "top", pcb_port_id: "top" },
        ],
      },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "locked_horizontal",
      route: [
        { x: -1, y: 0.193, z: 0, pcb_port_id: "left" },
        { x: 1, y: 0.193, z: 0, pcb_port_id: "right" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "vertical",
      route: [
        { x: 0, y: -0.5, z: 0, pcb_port_id: "bottom" },
        { x: 0, y: 0.1, z: 0, pcb_port_id: "top" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const repairedRoute = solver.getOutput()[0]!
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcIssueCount).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(repairedRoute.route).toHaveLength(6)
  expect(repairedRoute.route[0]).toEqual(hdRoutes[0]!.route[0]!)
  expect(repairedRoute.route.at(-1)).toEqual(hdRoutes[0]!.route.at(-1)!)
  expect(repairedRoute.vias).toHaveLength(0)

  const visualization = solver.visualize()
  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [1, 2, 3].map((step) => getStepGraphics(visualization, step)),
      {
        titles: [
          "Before: locked trace collision",
          "Local terminal-safe detour",
          "After: zero DRC errors",
        ],
      },
    ),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/locked-terminal-trace-detour-before-after.snap.svg",
    import.meta.url,
  ).pathname
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8").trim())
})
