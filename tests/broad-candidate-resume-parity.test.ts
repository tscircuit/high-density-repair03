import { expect, test } from "bun:test"
import {
  applyBroadRepulsionForces,
  createBroadRepulsionCandidateRunner,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import fixtureJson from "./fixtures/broad-contact-ties.json" with {
  type: "json",
}

test("resumed broad candidates preserve exact geometry and restart after acceptance", () => {
  for (const fixture of fixtureJson as Array<{
    srj: SimpleRouteJson
    routes: HighDensityRoute[]
  }>) {
    for (const effort of [1, 1.5, 2]) {
      const original = structuredClone(fixture.routes)
      const run = createBroadRepulsionCandidateRunner(fixture.srj, effort)
      const reference = (routes: HighDensityRoute[], multiplier: number) =>
        applyBroadRepulsionForces(
          fixture.srj,
          routes,
          effort,
          multiplier,
          undefined,
          true,
          false,
        )
      const first = run(fixture.routes, 1)
      const preservedFirst = structuredClone(first)
      expect(first).toEqual(reference(fixture.routes, 1))
      expect(run(fixture.routes, 2)).toEqual(reference(fixture.routes, 2))
      expect(first).toEqual(preservedFirst)
      expect(fixture.routes).toEqual(original)

      // Acceptance changes the incumbent: the long attempt must start from
      // the accepted result rather than resume its rejected predecessor.
      expect(run(first, 2)).toEqual(reference(first, 2))
      expect(first).toEqual(preservedFirst)
      expect(run(fixture.routes, 1)).toEqual(reference(fixture.routes, 1))

      const empty: HighDensityRoute[] = []
      expect(run(empty, 1)).toBe(empty)
      expect(run(empty, 2)).toBe(empty)
    }
  }
})
