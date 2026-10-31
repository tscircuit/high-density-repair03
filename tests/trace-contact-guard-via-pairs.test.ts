import { expect, test } from "bun:test"
import { TraceContactGuard, type HighDensityRoute } from "../lib"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("via annuli only contact when their physical drill layers overlap", () => {
  for (const allowBlindAndBuriedVias of [false, true]) {
    const { srj } = createViaContactGuardInput()
    srj.allowBlindAndBuriedVias = allowBlindAndBuriedVias
    const input: HighDensityRoute[] = [0, 1].map((index) => ({
      connectionName: index === 0 ? "wire" : "via",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: index, y: 0 }],
      route: [
        { x: index, y: 0, z: index * 2 },
        { x: index, y: 0, z: index * 2 + 1 },
      ],
    }))
    const guard = new TraceContactGuard({ srj, inputRoutes: input })
    for (const x of [0.29, 0.3, 0.31]) {
      const candidate = structuredClone(input)
      for (const point of candidate[1]!.route) point.x = x
      candidate[1]!.vias[0]!.x = x
      expect(guard.getNewContactPairs(candidate)).toEqual(
        !allowBlindAndBuriedVias && x < 0.3 ? [["via", "wire"]] : [],
      )
    }
  }
})
