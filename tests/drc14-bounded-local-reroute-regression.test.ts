import { expect, test } from "bun:test"
import samples from "dataset-drc14"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../lib/types/srj-types"
import { convertSimplifiedTraceToHdRoute } from "../lib/utils/convertSimplifiedTraceToHdRoute"

type Drc14Sample = {
  id?: string
  simpleRouteJson?: SimpleRouteJson & { traces?: SimplifiedPcbTrace[] }
}

test("cleans the three remaining DRC14 low-error plateaus", () => {
  for (const sampleId of ["circuit178", "circuit222", "circuit224"]) {
    const sample = (samples as Drc14Sample[]).find(
      (candidate) => candidate.id === sampleId,
    )
    const srj = sample?.simpleRouteJson
    if (!srj?.traces) throw new Error(`Missing DRC14 sample ${sampleId}`)
    const inputRoutes = srj.traces.map((trace) =>
      convertSimplifiedTraceToHdRoute(trace, srj),
    )
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes: inputRoutes,
    })

    solver.solve()

    expect(getDrcSnapshot(srj, solver.getOutput()).count).toBe(0)
    expect(solver.stats.globalDrcForceImproveBoundedLocalRerouteAttempted).toBe(
      true,
    )
    expect(solver.stats.globalDrcForceImproveBoundedLocalRerouteAccepted).toBe(
      true,
    )
  }
}, 20_000)
