import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type HighDensityRoute } from "../lib"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  getConnectivityMapFromSimpleRouteJson,
  loadSrj18Sample,
} from "../benchmarks/srj18Fixtures"

// Independent two-layer oracle for the sample 4 trace/through-via pair.
const getSample4CopperGap = (routes: HighDensityRoute[]): number => {
  const trace = routes.find(
    (route) => route.connectionName === "source_trace_25__source_net_25_mst1",
  )!
  const viaRoute = routes.find(
    (route) => route.connectionName === "source_trace_2__source_net_2_mst12",
  )!
  let gap = Infinity
  for (const via of viaRoute.vias) {
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]!,
        end = trace.route[index]!
      if (start.z !== end.z) continue
      const dx = end.x - start.x,
        dy = end.y - start.y
      const lengthSquared = dx * dx + dy * dy
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((via.x - start.x) * dx + (via.y - start.y) * dy) /
                  lengthSquared,
              ),
            )
      gap = Math.min(
        gap,
        Math.hypot(via.x - start.x - t * dx, via.y - start.y - t * dy) -
          (trace.traceThickness + viaRoute.viaDiameter) / 2,
      )
    }
  }
  return gap
}

test("SRJ18 contact protection retains baseline repair quality and terminals", () => {
  for (const [sample, ceiling] of [
    [4, 12],
    [6, 369],
    [13, 154],
  ] as const) {
    const { params } = loadSrj18Sample(sample - 1)
    const original = structuredClone(params)
    const connMap = getConnectivityMapFromSimpleRouteJson(params.srj)
    const solver = new GlobalDrcForceImproveSolver({
      ...params,
      effort: 1,
      connMap,
    })
    solver.solve()
    const output = solver.getOutput()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(getDrcSnapshot(params.srj, output).count).toBeLessThanOrEqual(
      ceiling,
    )
    expect(
      new TraceContactGuard({
        srj: params.srj,
        inputRoutes: params.hdRoutes,
        connMap,
      }).getNewContactPairs(output),
    ).toEqual([])
    expect(
      output.reduce((count, route) => count + route.vias.length, 0),
    ).toBeLessThanOrEqual(
      params.hdRoutes.reduce((count, route) => count + route.vias.length, 0),
    )
    expect(output).toHaveLength(params.hdRoutes.length)
    for (let index = 0; index < output.length; index++) {
      expect(output[index]!.route[0]).toEqual(params.hdRoutes[index]!.route[0])
      expect(output[index]!.route.at(-1)).toEqual(
        params.hdRoutes[index]!.route.at(-1),
      )
    }
    expect(params).toEqual(original)
    if (sample === 4)
      expect(getSample4CopperGap(output)).toBeGreaterThanOrEqual(-1e-9)
  }
})
