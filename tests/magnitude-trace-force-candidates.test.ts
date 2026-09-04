import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  getDrcErrorForceCandidates,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("obstacle force candidates use distinct magnitudes only until full clearance displacement", () => {
  for (const { y, clearance, expectedCount } of [
    { y: 0.4, clearance: 0.16, expectedCount: 1 },
    { y: 0, clearance: 0.4, expectedCount: 2 },
  ]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minTraceToPadEdgeClearance: clearance,
      bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 0.4,
          layers: ["top"],
          connectedTo: ["pcb_smtpad_foreign"],
        },
      ],
      connections: [{ name: "trace", pointsToConnect: [] }],
    }
    const routes: HighDensityRoute[] = [
      {
        connectionName: "trace",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -2, y, z: 0 },
          { x: -1, y, z: 0 },
          { x: 0, y, z: 0 },
          { x: 1, y, z: 0 },
          { x: 2, y, z: 0 },
        ],
        vias: [],
      },
    ]
    const engine = new AutoroutingDrcEngine(srj, { traceClearance: 0.16 })
    const before = getDrcSnapshot(srj, routes, undefined, undefined, engine)
    expect(before.errors).toHaveLength(1)
    const candidates = [
      ...getDrcErrorForceCandidates(
        srj,
        routes,
        before.errors[0]!,
        before.traceRouteIndexById,
        [1, 1.75, -1],
      ),
    ]
    expect(candidates).toHaveLength(expectedCount)
    expect(
      new Set(candidates.map((candidate) => JSON.stringify(candidate))).size,
    ).toBe(expectedCount)
    if (expectedCount === 1) {
      expect(
        getDrcSnapshot(srj, candidates[0]!, undefined, undefined, engine).count,
      ).toBe(0)
    }
    expect(routes[0]!.route[1]!.y).toBe(y)
  }
})
