import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { createBroadNetMatchers } from "../lib/solvers/GlobalDrcForceImproveSolver/broadNetMatchers"
import {
  obstacleSharesNet,
  sharesNet,
} from "../lib/solvers/GlobalDrcForceImproveSolver/netUtils"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

class CountingConnectivityMap extends ConnectivityMap {
  lookupCount = 0

  override getNetConnectedToId(id: string) {
    this.lookupCount += 1
    return super.getNetConnectedToId(id)
  }
}

const createInput = () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 3, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0.08 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["pad_a"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = ["route_a", "route_b"].map(
    (connectionName, index) => ({
      connectionName,
      route: [
        { x: 0, y: index * 0.15, z: 0 },
        { x: 1, y: index * 0.15, z: 0 },
        { x: 2, y: index * 0.15, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  )
  const connMap = new CountingConnectivityMap({
    net_a: ["route_a"],
    net_b: ["route_b"],
    net_pad: ["pad_a"],
  })
  return { srj, routes, connMap }
}

test("broad net caches preserve ordered aliases, unknown IDs and false results", () => {
  const { srj, connMap } = createInput()
  const owners = [
    "route_a",
    "net_a",
    "route_b",
    "net_b",
    "constructor",
    "__proto__",
    "",
    "unknown",
  ].map((rootConnectionName, routeIndex) => ({
    rootConnectionName,
    routeIndex,
  }))
  const obstacles = [
    srj.obstacles[0]!,
    { ...srj.obstacles[0]!, connectedTo: ["route_a", "unknown", "route_a"] },
    { ...srj.obstacles[0]!, connectedTo: [] },
  ]
  const cache = createBroadNetMatchers(owners.length, obstacles.length, connMap)
  const expectedPairs = owners.map((left) =>
    owners.map((right) =>
      sharesNet(left.rootConnectionName, right.rootConnectionName, connMap),
    ),
  )
  const expectedObstacles = obstacles.map((obstacle) =>
    owners.map((owner) =>
      obstacleSharesNet(owner.rootConnectionName, obstacle, connMap),
    ),
  )
  for (let left = 0; left < owners.length; left += 1) {
    for (let right = 0; right < owners.length; right += 1) {
      expect(cache.routesShareNet(owners[left]!, owners[right]!)).toBe(
        expectedPairs[left]![right]!,
      )
    }
  }
  for (let index = 0; index < obstacles.length; index += 1) {
    const matcher = cache.forObstacle(obstacles[index]!)
    for (let route = 0; route < owners.length; route += 1) {
      expect(matcher(owners[route]!)).toBe(expectedObstacles[index]![route]!)
    }
  }
  const firstPassLookups = connMap.lookupCount
  for (let left = 0; left < owners.length; left += 1) {
    for (let right = 0; right < owners.length; right += 1) {
      expect(cache.routesShareNet(owners[left]!, owners[right]!)).toBe(
        expectedPairs[left]![right]!,
      )
    }
  }
  for (let index = 0; index < obstacles.length; index += 1) {
    for (let route = 0; route < owners.length; route += 1) {
      expect(cache.forObstacle(obstacles[index]!)(owners[route]!)).toBe(
        expectedObstacles[index]![route]!,
      )
    }
  }
  expect(connMap.lookupCount).toBe(firstPassLookups)
})

test("broad force calls refresh net matches after live connectivity and obstacle changes", () => {
  const { srj, routes, connMap } = createInput()
  const original = structuredClone({ srj, routes })
  const first = applyBroadRepulsionForces(srj, routes, 1, 1, connMap)
  expect(first).not.toEqual(routes)
  expect(connMap.lookupCount).toBeLessThanOrEqual(6)
  expect({ srj, routes }).toEqual(original)

  connMap.addConnections([["route_a", "route_b", "pad_a"]])
  connMap.lookupCount = 0
  expect(applyBroadRepulsionForces(srj, routes, 1, 1, connMap)).toBe(routes)
  expect(connMap.lookupCount).toBeGreaterThan(0)
  srj.obstacles[0]!.connectedTo = ["foreign_pad"]
  connMap.lookupCount = 0
  expect(applyBroadRepulsionForces(srj, routes, 1, 1, connMap)).not.toEqual(
    routes,
  )
  expect(connMap.lookupCount).toBeGreaterThan(0)
  expect(routes).toEqual(original.routes)
})

test("oversized net tables retain uncached predicates", () => {
  const { srj, connMap } = createInput()
  const cache = createBroadNetMatchers(1025, 1025, connMap)
  const left = { routeIndex: 0, rootConnectionName: "route_a" }
  const right = { routeIndex: 1, rootConnectionName: "route_b" }
  for (let iteration = 0; iteration < 2; iteration += 1) {
    expect(cache.routesShareNet(left, right)).toBe(false)
    expect(cache.forObstacle(srj.obstacles[0]!)(left)).toBe(false)
  }
  expect(connMap.lookupCount).toBe(8)
})
