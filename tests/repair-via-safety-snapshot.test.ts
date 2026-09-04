import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import {
  AutoroutingDrcEngine,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { DrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import fixture from "./fixtures/repair-via-safety-before.json"

const createPanel = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  before: boolean,
): GraphicsObject => ({
  coordinateSystem: "cartesian",
  rects: [
    {
      center: { x: 0, y: -0.25 },
      width: 5,
      height: 5.7,
      fill: "transparent",
      stroke: "transparent",
    },
    ...srj.obstacles.map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      fill: "#eab308",
      stroke: "#a16207",
    })),
  ],
  lines: routes.flatMap((route) =>
    route.route.slice(1).flatMap((point, index) => {
      const previous = route.route[index]!
      if (previous.z !== point.z) return []
      return [
        {
          points: [previous, point],
          strokeWidth: route.traceThickness,
          strokeColor:
            point.z === 1
              ? "#ea580c"
              : route.connectionName === "horizontal"
                ? "#2563eb"
                : "#9333ea",
        },
      ]
    }),
  ),
  circles: [
    ...routes.flatMap((route) =>
      route.vias.flatMap((via) => [
        {
          center: via,
          radius: route.viaDiameter / 2,
          fill: "#ea580c",
          stroke: "#9a3412",
        },
        {
          center: via,
          radius: 0.06,
          fill: "white",
          stroke: "#9a3412",
        },
      ]),
    ),
    ...(before
      ? [-0.5, 0.5].map((x) => ({
          center: { x, y: 0.125 },
          radius: 0.28,
          fill: "transparent",
          stroke: "#dc2626",
        }))
      : [
          {
            center: { x: 0, y: 0 },
            radius: 0.25,
            fill: "transparent",
            stroke: "#dc2626",
          },
        ]),
  ],
  texts: [
    {
      x: 0,
      y: 2.38,
      text: "ONE REPAIR ITERATION — not a completed route",
      fontSize: 0.13,
      anchorSide: "center",
      color: "#475569",
    },
    {
      x: 0,
      y: -2.38,
      text: before
        ? "2 new via-pad violations: gap 0.050 vs required 0.100 mm"
        : "Unsafe vias rejected; original crossing remains",
      fontSize: 0.13,
      anchorSide: "center",
      color: "#b91c1c",
    },
    {
      x: 0,
      y: -2.63,
      text: "Blue / purple: top traces | Orange: bottom trace + vias",
      fontSize: 0.11,
      anchorSide: "center",
      color: "#475569",
    },
    {
      x: 0,
      y: -2.86,
      text: "Gold: foreign bottom pads | Red rings: DRC conflicts",
      fontSize: 0.11,
      anchorSide: "center",
      color: "#475569",
    },
  ],
})

test("snapshot shows an unsafe via-creating repair being rejected", async (): Promise<void> => {
  const srj = fixture.srj as SimpleRouteJson
  const inputRoutes: HighDensityRoute[] = fixture.inputRoutes
  const beforeRoutes: HighDensityRoute[] = fixture.beforeOutputRoutes
  const engine = new AutoroutingDrcEngine(srj)
  const evaluate = (routes: HighDensityRoute[]): DrcSnapshot =>
    getDrcSnapshot(srj, routes, undefined, undefined, engine)

  // The frozen output was produced by the actual base-commit solver. Both
  // panels are checked with real geometry, never a mocked evaluator.
  expect(fixture.provenance.commit).toBe(
    "c16f524607897f78773f51cb0ca1cc94b15f3d6c",
  )
  expect(evaluate(inputRoutes).errors).toMatchObject([
    { type: "pcb_trace_error" },
  ])
  const before = evaluate(beforeRoutes)
  expect(before.errors).toHaveLength(2)
  for (const error of before.errors) {
    expect(error.type).toBe("pcb_pad_pad_clearance_error")
    expect(error.pcb_via_ids).toHaveLength(1)
    expect(error.actual_clearance).toBeCloseTo(0.05, 6)
    expect(error.minimum_clearance).toBe(0.1)
  }

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: structuredClone(inputRoutes),
    ...fixture.solverOptions,
  })
  solver.solve()
  const afterRoutes = solver.getOutput()
  expect(solver.failed).toBe(false)
  expect(solver.stats.globalDrcForceImproveCandidateAttempts).toBeGreaterThan(0)
  expect(solver.stats.globalDrcForceImproveTargetedForceAccepted).toBe(false)
  expect(afterRoutes).toEqual(inputRoutes)
  expect(afterRoutes.flatMap((route) => route.vias)).toHaveLength(0)
  expect(evaluate(afterRoutes).errors).toMatchObject([
    { type: "pcb_trace_error" },
  ])

  const graphics = stackGraphicsHorizontally(
    [createPanel(srj, beforeRoutes, true), createPanel(srj, afterRoutes, false)],
    {
      titles: ["Before: unsafe vias", "After: change rejected"],
    },
  )
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1400,
    svgHeight: 850,
  }).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/repair-via-safety.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    writeFileSync(snapshotPath, svg)
    writeFileSync(
      snapshotPath.replace(/\.svg$/, ".png"),
      await getPngBufferFromGraphicsObject(graphics, {
        backgroundColor: "white",
        pngWidth: 1400,
        pngHeight: 850,
      }),
    )
  }
  expect(svg).toBe(readFileSync(snapshotPath, "utf8"))
})
