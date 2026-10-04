import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { hasClosedBroadForceContext } from "../lib/solvers/GlobalDrcForceImproveSolver/broadForceContext"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import { createBoardClosedForceCase } from "./fixtures/createBoardClosedForceCase"
import golden from "./fixtures/board-closed-force-context-golden.json" with {
  type: "json",
}

test("board reflection hooks disable closed force kernels without early callbacks", () => {
  for (const expected of golden.cases) {
    const fixture = createBoardClosedForceCase(
      expected.variant,
      RELAXED_DRC_OPTIONS,
    )
    let eligible = false
    let gateEvents = 0
    let output: HighDensityRoute[] = []
    try {
      fixture.activate()
      const before = fixture.events.length
      eligible = hasClosedBroadForceContext(
        fixture.srj,
        fixture.routes,
        fixture.effort,
        1,
        fixture.connMap,
        false,
        false,
      )
      gateEvents = fixture.events.length - before
      output = applyBroadRepulsionForces(
        fixture.srj,
        fixture.routes,
        fixture.effort,
        1,
        fixture.connMap,
        false,
        false,
      )
    } finally {
      fixture.restore()
    }
    expect(gateEvents).toBe(0)
    expect(eligible).toBe(expected.variant === "native")
    expect(output).toEqual(expected.output as HighDensityRoute[])
    expect(fixture.events.length).toBe(expected.eventCount)
    expect(
      createHash("sha256").update(JSON.stringify(fixture.events)).digest("hex"),
    ).toBe(expected.eventSha256)
    if (expected.variant === "descriptor-clone-mutation") {
      expect(fixture.events).toContain("mutate-cloned-point")
    }
  }
})
