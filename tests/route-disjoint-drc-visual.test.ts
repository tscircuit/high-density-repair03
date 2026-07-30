import { expect, test } from "bun:test"
import "graphics-debug/matcher"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type { DrcEvaluator, HighDensityRoute, SimpleRouteJson } from "../lib"

const createActiveRoute = (
  connectionName: string,
  y: number,
): HighDensityRoute => ({
  connectionName,
  route: [
    { x: 0, y: y - 1, z: 0 },
    { x: 0, y, z: 0 },
    { x: 5, y, z: 0 },
    { x: 10, y, z: 0 },
    { x: 10, y: y - 1, z: 0 },
  ],
  vias: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
})

const createEmptyRoute = (connectionName: string): HighDensityRoute => ({
  connectionName,
  route: [],
  vias: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
})

test("visualizes route-disjoint batch selection before and after repair", async () => {
  const activeRoutes = [createActiveRoute("A", 0), createActiveRoute("B", 4)]
  const emptyRoutes = Array.from({ length: 119 }, (_, index) =>
    createEmptyRoute(`unused_${index}`),
  )
  const hdRoutes = [...activeRoutes, ...emptyRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 6 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad_a"],
        obstacleId: "pad_a",
      },
      {
        type: "rect",
        center: { x: 8, y: 4 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad_b"],
        obstacleId: "pad_b",
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Record<string, unknown>[] = []
    if ((routes?.[0]?.route[1]?.y ?? 0) < 0.2) {
      errors.push({
        type: "pcb_trace_error",
        message:
          'PCB trace A_0 overlaps with pcb_smtpad "pad_a" (gap: -0.050mm)',
        center: { x: 2, y: 0 },
        pcb_trace_id: "A_0",
        pcb_trace_ids: ["A_0"],
        pcb_obstacle_id: "pad_a",
      })
    }
    if (Math.abs((routes?.[1]?.route[1]?.y ?? 4) - 4) < 0.2) {
      errors.push({
        type: "pcb_trace_error",
        message:
          'PCB trace B_0 overlaps with pcb_smtpad "pad_b" (gap: -0.050mm)',
        center: { x: 8, y: 4 },
        pcb_trace_id: "B_0",
        pcb_trace_ids: ["B_0"],
        pcb_obstacle_id: "pad_b",
      })
    }
    return errors
  }
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })

  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "batch-selected",
  })

  solver.solve()

  expect(solver.stats.globalDrcForceImproveRouteDisjointBatchesAccepted).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "batch-repaired",
  })
})
