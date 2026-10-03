import { expect, test } from "bun:test"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import fixtureJson from "./fixtures/broad-contact-ties.json" with {
  type: "json",
}

type ContactFixture = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  expected: HighDensityRoute[]
}

test("broad repulsion keeps the established contact choice for equal distances", () => {
  for (const fixture of fixtureJson as ContactFixture[]) {
    const originalRoutes = structuredClone(fixture.routes)
    const output = applyBroadRepulsionForces(
      fixture.srj,
      fixture.routes,
      1,
      1,
      undefined,
      false,
      false,
    )
    expect(output).toEqual(fixture.expected)
    expect(fixture.routes).toEqual(originalRoutes)
  }
})
