import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { GlobalDrcForceImproveSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { DrcEvaluator } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.1,
  bounds: { minX: -5, minY: -2, maxX: 5, maxY: 2 },
  obstacles: [],
  connections: [
    {
      name: "moving",
      pointsToConnect: [
        { x: -4, y: 0, layer: "top", pointId: "moving-start" },
        { x: 4, y: 0, layer: "top", pointId: "moving-end" },
      ],
    },
    {
      name: "foreign",
      pointsToConnect: [
        { x: 0.5, y: -1, layer: "top", pointId: "foreign-start" },
        { x: 0.5, y: 1, layer: "top", pointId: "foreign-end" },
      ],
    },
  ],
}

const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "moving",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((x) => ({
      x,
      y: 0,
      z: 0,
    })),
    vias: [],
  },
  {
    connectionName: "foreign",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.5, y: -1, z: 0 },
      { x: 0.5, y: 1, z: 0 },
    ],
    vias: [],
  },
]

const traceError = {
  type: "pcb_trace_error",
  pcb_trace_id: "moving_0",
  pcb_trace_error_id: "overlap_moving_0_foreign_0",
  center: { x: 0.5, y: 0 },
}

const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
  const candidateRoutes = hdRoutes ?? routes ?? []
  const movingRoute = candidateRoutes.find(
    (route) => route.connectionName === "moving",
  )
  const usesRequiredTransitionPair =
    movingRoute?.vias.length === 2 &&
    Math.abs(movingRoute.vias[0]!.x + 1) < 1e-6 &&
    Math.abs(movingRoute.vias[1]!.x - 3) < 1e-6

  return usesRequiredTransitionPair
    ? { errors: [], errorsWithCenters: [] }
    : { errors: [traceError], errorsWithCenters: [traceError] }
}

const getPanelX = (x: number, offsetX: number): number =>
  offsetX + 140 + x * 24

const getPanelY = (y: number): number => 120 - y * 40

const getPlanarRuns = (
  route: HighDensityRoute,
): Array<{ z: number; points: HighDensityRoute["route"] }> => {
  const runs: Array<{
    z: number
    points: HighDensityRoute["route"]
  }> = []
  let currentPoints: HighDensityRoute["route"] = []

  for (const point of route.route) {
    const previousPoint = currentPoints.at(-1)
    if (previousPoint && previousPoint.z !== point.z) {
      if (currentPoints.length > 1) {
        runs.push({ z: previousPoint.z, points: currentPoints })
      }
      currentPoints = [point]
      continue
    }
    currentPoints.push(point)
  }

  if (currentPoints.length > 1) {
    runs.push({ z: currentPoints[0]!.z, points: currentPoints })
  }
  return runs
}

const renderPanel = (params: {
  routes: HighDensityRoute[]
  offsetX: number
  title: string
  showConflict: boolean
}): string[] => {
  const elements = [
    `  <rect x="${params.offsetX + 20}" y="40" width="280" height="160" fill="#f8fafc" stroke="#94a3b8"/>`,
    `  <text x="${params.offsetX + 160}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14">${params.title}</text>`,
  ]

  for (const route of params.routes) {
    for (const run of getPlanarRuns(route)) {
      const stroke =
        route.connectionName === "foreign"
          ? "#dc2626"
          : run.z === 0
            ? "#2563eb"
            : "#16a34a"
      const points = run.points
        .map(
          (point) =>
            `${getPanelX(point.x, params.offsetX)},${getPanelY(point.y)}`,
        )
        .join(" ")
      elements.push(
        `  <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>`,
      )
    }

    for (const via of route.vias) {
      elements.push(
        `  <circle cx="${getPanelX(via.x, params.offsetX)}" cy="${getPanelY(via.y)}" r="6" fill="#111827" stroke="#f8fafc" stroke-width="2"/>`,
      )
    }
  }

  if (params.showConflict) {
    elements.push(
      `  <circle cx="${getPanelX(0.5, params.offsetX)}" cy="${getPanelY(0)}" r="9" fill="none" stroke="#7e22ce" stroke-width="3"/>`,
    )
  }
  return elements
}

const renderBeforeAfterSnapshot = (
  beforeRoutes: HighDensityRoute[],
  afterRoutes: HighDensityRoute[],
): string =>
  [
    '<svg width="640" height="240" viewBox="0 0 640 240" xmlns="http://www.w3.org/2000/svg">',
    '  <rect width="640" height="240" fill="white"/>',
    ...renderPanel({
      routes: beforeRoutes,
      offsetX: 0,
      title: "Before: crossing on layer 0",
      showConflict: true,
    }),
    ...renderPanel({
      routes: afterRoutes,
      offsetX: 320,
      title: "After: asymmetric internal span",
      showConflict: false,
    }),
    '  <text x="320" y="224" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#475569">blue: layer 0 · green: layer 1 · red: foreign trace · black: vias</text>',
    "</svg>",
  ].join("\n") + "\n"

test("searches independent internal layer-move boundaries", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    drcEvaluator,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })

  solver.solve()

  const outputRoutes = solver.getOutput()
  const outputMovingRoute = outputRoutes.find(
    (route) => route.connectionName === "moving",
  )!
  expect(solver.failed).toBe(false)
  expect(getDrcSnapshot(srj, outputRoutes, drcEvaluator).count).toBe(0)
  expect(outputMovingRoute.vias).toEqual([
    { x: -1, y: 0 },
    { x: 3, y: 0 },
  ])
  expect(outputMovingRoute.route.some((point) => point.z === 1)).toBe(true)

  const snapshotSvg = renderBeforeAfterSnapshot(inputRoutes, outputRoutes)
  const snapshotPath = new URL(
    "./__snapshots__/asymmetric-safe-trace-layer-span.snap.svg",
    import.meta.url,
  ).pathname
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
