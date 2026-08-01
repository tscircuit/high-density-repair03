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
  const activeRouteSpecs = [
    { connectionName: "A", y: 0, obstacleX: 2 },
    { connectionName: "B", y: 4, obstacleX: 8 },
    { connectionName: "C", y: 8, obstacleX: 2 },
    { connectionName: "D", y: 12, obstacleX: 8 },
  ]
  const activeRoutes = activeRouteSpecs.map(({ connectionName, y }) =>
    createActiveRoute(connectionName, y),
  )
  const emptyRoutes = Array.from({ length: 117 }, (_, index) =>
    createEmptyRoute(`unused_${index}`),
  )
  const hdRoutes = [...activeRoutes, ...emptyRoutes]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -2, maxX: 11, maxY: 14 },
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: activeRouteSpecs.map(({ connectionName, y, obstacleX }) => ({
      type: "rect",
      center: { x: obstacleX, y },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [`pad_${connectionName.toLowerCase()}`],
      obstacleId: `pad_${connectionName.toLowerCase()}`,
    })),
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Record<string, unknown>[] = []
    for (let index = 0; index < activeRouteSpecs.length; index += 1) {
      const spec = activeRouteSpecs[index]!
      if (Math.abs((routes?.[index]?.route[1]?.y ?? spec.y) - spec.y) >= 0.2) {
        continue
      }
      const traceId = `${spec.connectionName}_0`
      const obstacleId = `pad_${spec.connectionName.toLowerCase()}`
      errors.push({
        type: "pcb_trace_error",
        message: `PCB trace ${traceId} overlaps with pcb_smtpad "${obstacleId}" (gap: -0.050mm)`,
        center: { x: spec.obstacleX, y: spec.y },
        pcb_trace_id: traceId,
        pcb_trace_ids: [traceId],
        pcb_obstacle_id: obstacleId,
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
