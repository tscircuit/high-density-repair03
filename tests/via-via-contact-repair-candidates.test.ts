import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getTraceViaContactRepairCandidates } from "../lib/solvers/GlobalDrcForceImproveSolver/getTraceViaContactRepairCandidates"

test("annulus candidates separate via-only contacts without moving terminals", () => {
  const routes: HighDensityRoute[] = [0, 0.29].map((x, index) => ({
    connectionName: `net${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x, y: 0 }],
    route: [
      { x: index === 0 ? -2 : 2, y: 0, z: 0 },
      { x, y: 0, z: 0 },
      { x, y: 0, z: 1 },
      { x: index === 0 ? -2 : 2, y: 1, z: 1 },
    ],
  }))
  const original = structuredClone(routes)
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: routes.map(({ connectionName }) => ({
      name: connectionName,
      pointsToConnect: [],
    })),
  }
  let output: HighDensityRoute[] | undefined
  for (const candidate of getTraceViaContactRepairCandidates({
    srj,
    routes,
    pair: ["net0", "net1"],
  })) {
    const a = candidate[0]!.vias[0]!,
      b = candidate[1]!.vias[0]!
    if (Math.hypot(a.x - b.x, a.y - b.y) >= 0.3) {
      output = candidate
      break
    }
  }
  expect(output).toBeDefined()
  for (const [index, route] of output!.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.vias).toHaveLength(1)
    expect(route.route[1]!.x).toBe(route.route[2]!.x)
    expect(route.route[1]!.y).toBe(route.route[2]!.y)
  }
  expect(routes).toEqual(original)
})
