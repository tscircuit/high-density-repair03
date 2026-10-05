import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { hasClosedBroadForceContext } from "../lib/solvers/GlobalDrcForceImproveSolver/broadForceContext"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import { createBoardClosedForceCase } from "./fixtures/createBoardClosedForceCase"
import {
  createBoardContextReplayCase,
  mutateBoardContextReplayInput,
} from "./fixtures/createBoardContextReplayCase"
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
  const originalDelete = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "delete",
  )!
  let deleteHooks = 0
  const fixture = createBoardClosedForceCase("native", RELAXED_DRC_OPTIONS)
  try {
    Object.defineProperty(WeakMap.prototype, "delete", {
      ...originalDelete,
      value(this: WeakMap<object, unknown>, key: object): boolean {
        deleteHooks += 1
        return Reflect.apply(originalDelete.value, this, [key])
      },
    })
    expect(
      hasClosedBroadForceContext(
        fixture.srj,
        fixture.routes,
        fixture.effort,
        1,
        fixture.connMap,
        false,
        false,
      ),
    ).toBeTrue()
    expect(
      applyBroadRepulsionForces(
        fixture.srj,
        fixture.routes,
        fixture.effort,
        1,
        fixture.connMap,
        false,
        false,
      ),
    ).toEqual(golden.cases.find((entry) => entry.variant === "native")!.output)
    expect(deleteHooks).toBe(0)
  } finally {
    Object.defineProperty(WeakMap.prototype, "delete", originalDelete)
  }
  const replay = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/board-context-full-force-golden.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as {
    format: string
    originalPin: string
    callsPerCase: number
    cases: Array<{
      caseIndex: number
      expectedFirst: HighDensityRoute[]
      expectedSecond: HighDensityRoute[]
    }>
  }
  expect([
    replay.format,
    replay.originalPin,
    replay.callsPerCase,
    replay.cases.length,
  ]).toEqual([
    "board-context-full-force-replay-v1",
    "da5fdcac6193b4af88a6b81b2060c6e709d58cab",
    2,
    128,
  ])
  for (const expected of replay.cases) {
    const input = createBoardContextReplayCase(expected.caseIndex)
    const before = JSON.stringify(input)
    const first = applyBroadRepulsionForces(input.srj, input.routes, 1, 0.5)
    expect(first).toEqual(expected.expectedFirst)
    expect(JSON.stringify(input)).toBe(before)
    mutateBoardContextReplayInput(input.srj, expected.caseIndex)
    const second = applyBroadRepulsionForces(input.srj, first, 1, 0.5)
    expect(second).toEqual(expected.expectedSecond)
  }
})
