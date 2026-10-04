import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { hasClosedBroadForceContext } from "../lib/solvers/GlobalDrcForceImproveSolver/broadForceContext"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import { createClosedForceCase } from "./fixtures/createClosedForceCase"
import golden from "./fixtures/closed-force-context-golden.json" with {
  type: "json",
}

test("closed broad contexts preserve original forces and all unsupported hook ordering", () => {
  for (const expected of golden.cases) {
    const fixture = createClosedForceCase(expected.variant, RELAXED_DRC_OPTIONS)
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
    expect(eligible).toBe(
      [
        "plain",
        "native-provider",
        "merged-provider",
        "null-prototype-provider",
      ].includes(expected.variant),
    )
    expect(output).toEqual(expected.output as HighDensityRoute[])
    expect(fixture.events.length).toBe(expected.eventCount)
    expect(
      createHash("sha256")
        .update(JSON.stringify(fixture.events))
        .digest("hex"),
    ).toBe(expected.eventSha256)
  }

  const fixture = createClosedForceCase("native-provider", RELAXED_DRC_OPTIONS)
  const eligible = (): boolean =>
    hasClosedBroadForceContext(
      fixture.srj,
      fixture.routes,
      fixture.effort,
      1,
      fixture.connMap,
      false,
      false,
    )
  const native = golden.cases.find(
    (entry) => entry.variant === "native-provider",
  )!
  const merged = golden.cases.find(
    (entry) => entry.variant === "merged-provider",
  )!
  expect(eligible()).toBeTrue()
  expect(
    applyBroadRepulsionForces(
      fixture.srj,
      fixture.routes,
      1,
      1,
      fixture.connMap,
      false,
      false,
    ),
  ).toEqual(native.output as HighDensityRoute[])
  fixture.connMap!.addConnections([["left", "right"]])
  expect(eligible()).toBeTrue()
  expect(
    applyBroadRepulsionForces(
      fixture.srj,
      fixture.routes,
      1,
      1,
      fixture.connMap,
      false,
      false,
    ),
  ).toEqual(merged.output as HighDensityRoute[])

  const point = fixture.routes[0]!.route[1]!
  fixture.routes[0]!.route[1] = Object.assign(Object.create(null), point)
  expect(eligible()).toBeTrue()
  const shared = { value: 1 }
  const metadata = fixture.routes as unknown as Array<Record<string, unknown>>
  metadata[0]!.metadata = shared
  metadata[1]!.metadata = shared
  expect(eligible()).toBeTrue()
  metadata[0]!.metadata = metadata[0]
  expect(eligible()).toBeFalse()
  delete metadata[0]!.metadata
  delete metadata[1]!.metadata
  delete fixture.routes[0]!.route[1]
  expect(eligible()).toBeFalse()
  fixture.routes[0]!.route[1] = point
  for (const value of [NaN, Infinity, -Infinity, 10_000.000001]) {
    point.x = value
    expect(eligible()).toBeFalse()
  }
  point.x = -0
  expect(eligible()).toBeTrue()
  point.x = 0
  expect(eligible()).toBeTrue()
})
