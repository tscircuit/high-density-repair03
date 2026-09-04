import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPointToObstacleDistance } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("only a pre-existing via can retain an own-pad attachment after a topology edit", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "own-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.7,
        layers: ["top"],
        connectedTo: ["own-net"],
      },
    ],
  }
  const candidate: HighDensityRoute = {
    connectionName: "own-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -0.8, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 1, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  // The previous trace crossed the pad on one layer, but had no via there.
  const beforeLayerChange: HighDensityRoute = {
    ...candidate,
    route: candidate.route.map((point) => ({ ...point, z: 0 })),
    vias: [],
  }
  const candidates = [candidate]
  const before = structuredClone(candidates)
  const existingBefore = structuredClone(beforeLayerChange)
  const output = applyViaToPadClearanceRelaxation(
    srj,
    candidates,
    undefined,
    0,
    [beforeLayerChange],
  )
  expect(output).not.toBe(candidates)
  expect(
    getPointToObstacleDistance(output[0]!.vias[0]!, srj.obstacles[0]!),
  ).toBeGreaterThanOrEqual(candidate.viaDiameter / 2)

  // A genuine existing via stays attached even if a topology edit inserted
  // route points before it. Attachment identity follows its site, not indexes.
  const existingAttachment: HighDensityRoute = {
    ...candidate,
    route: candidate.route.filter((_, pointIndex) => pointIndex !== 1),
  }
  expect(
    applyViaToPadClearanceRelaxation(srj, candidates, undefined, 0, [
      existingAttachment,
    ]),
  ).toBe(candidates)
  expect(candidates).toEqual(before)
  expect(beforeLayerChange).toEqual(existingBefore)
})
