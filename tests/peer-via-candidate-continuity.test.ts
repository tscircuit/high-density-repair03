import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPeerTraceViaCandidates } from "../lib/solvers/GlobalDrcForceImproveSolver/getPeerTraceViaCandidates"

test("peer via candidates move every layer of a stack and keep unlabelled terminals fixed", () => {
  const interior: HighDensityRoute = {
    connectionName: "interior",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const terminal: HighDensityRoute = {
    ...interior,
    connectionName: "terminal",
    route: interior.route.slice(1),
  }
  const routes = [interior, terminal]
  const original = structuredClone(routes)
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [],
  }
  const proposals = [
    ...getPeerTraceViaCandidates({
      srj,
      routes,
      previousRoutes: [],
      affectedConnections: new Set(["interior", "terminal"]),
    }),
  ]
  expect(proposals.length).toBeGreaterThan(0)
  for (const proposal of proposals) {
    const points = proposal[0]!.route
    expect(points[0]).toEqual(interior.route[0])
    expect(points.at(-1)).toEqual(interior.route.at(-1))
    expect(points.slice(1, 4).map((point) => [point.x, point.y])).toEqual(
      Array.from({ length: 3 }, () => [points[1]!.x, points[1]!.y]),
    )
    expect(points.map((point) => point.z)).toEqual(
      interior.route.map((point) => point.z),
    )
    expect(proposal[1]).toEqual(terminal)
    expect(proposal[0]!.vias).toHaveLength(1)
  }
  expect(routes).toEqual(original)
})
