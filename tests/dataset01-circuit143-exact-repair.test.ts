import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimplifiedPcbTraces,
  type SimpleRouteJson,
} from "../lib"
import exactInput from "./fixtures/dataset01-circuit143-exact-input.json"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"

const getLayerName = (z: number, layerCount: number) => {
  if (z === 0) return "top"
  if (z === layerCount - 1) return "bottom"
  return `inner${z}`
}

const convertHdRoutesToSimplifiedTraces = (
  hdRoutes: HighDensityRoute[],
  layerCount: number,
): SimplifiedPcbTraces =>
  hdRoutes.map((route) => {
    const simplifiedRoute: SimplifiedPcbTraces[number]["route"] = []

    for (let index = 0; index < route.route.length; index += 1) {
      const point = route.route[index]!
      const previous = route.route[index - 1]
      const layer = getLayerName(point.z, layerCount)

      if (previous && previous.z !== point.z) {
        simplifiedRoute.push({
          route_type: "via",
          x: point.x,
          y: point.y,
          from_layer: getLayerName(previous.z, layerCount),
          to_layer: layer,
          via_diameter: route.viaDiameter,
        })
      }

      const lastPoint = simplifiedRoute.at(-1)
      if (
        lastPoint?.route_type !== "wire" ||
        lastPoint.x !== point.x ||
        lastPoint.y !== point.y ||
        lastPoint.layer !== layer
      ) {
        simplifiedRoute.push({
          route_type: "wire",
          x: point.x,
          y: point.y,
          width: route.traceThickness,
          layer,
        })
      }
    }

    return {
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_0`,
      connection_name: route.connectionName.replace(/_mst\d+$/, ""),
      connectsTo: [],
      route: simplifiedRoute,
    }
  })

test("repairs the exact dataset01 circuit143 DRC chain without broad fallback", () => {
  const { srj, hdRoutes } = structuredClone(exactInput) as unknown as {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes: candidateRoutes }) =>
    engine.evaluate(
      convertHdRoutesToSimplifiedTraces(
        routes ?? candidateRoutes ?? [],
        srj.layerCount,
      ),
    )

  const initialDrc = engine.evaluate(
    convertHdRoutesToSimplifiedTraces(hdRoutes, srj.layerCount),
  )
  expect(initialDrc.errors).toHaveLength(2)
  expect(
    initialDrc.errors.some(
      (error) =>
        error.pcb_trace_id === "source_net_23_mst0_0" &&
        error.message?.includes("source_net_22_mst1_0"),
    ),
  ).toBe(true)
  expect(
    initialDrc.errors.some(
      (error) =>
        error.pcb_trace_id === "source_net_22_mst1_0" &&
        error.message?.includes("via_"),
    ),
  ).toBe(true)

  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 32,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
    viaInPadMaxIterations: 32,
    broadMaxIterations: 12,
    broadPassMultiplier: 3,
  })

  solver.solve()

  const finalDrc = engine.evaluate(
    convertHdRoutesToSimplifiedTraces(solver.getOutput(), srj.layerCount),
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(finalDrc.errors).toHaveLength(0)
  expect(solver.solved && finalDrc.errors.length > 0).toBe(false)
  expect(solver.stats.drcBranchPortfolioInitialDrcIssueCount).toBe(2)
  expect(solver.stats.drcBranchPortfolioBaselineDrcIssueCount).toBe(1)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.drcBranchPortfolioBroadInitialDrcIssueCount).toBe(
    undefined,
  )
  expect(solver.stats.drcBranchPortfolioBroadBranchAttempted).toBe(false)
  expect(solver.stats.drcBranchPortfolioBroadBranchAccepted).toBe(false)
  expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAttempted).toBe(true)
  expect(solver.stats.drcBranchPortfolioSafeTraceLayerPhaseAccepted).toBe(true)
  expect(solver.stats.globalDrcForceImproveBroadForceAccepted).toBe(false)
  expectSrjRepairSnapshot(srj, hdRoutes, solver.getOutput(), import.meta.path)
})
