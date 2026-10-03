import { expect, test } from "bun:test"
import {
  collectViaNodes,
  getSameRootViaSite,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { COORDINATE_EPSILON } from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type {
  MutableRoute,
  ViaNode,
} from "../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import type { SimpleRouteJson } from "../lib/types"

const getOriginalSameRootViaSite = (
  routes: MutableRoute[],
  via: ViaNode,
  srj: SimpleRouteJson,
): ViaNode[] => {
  const currentVias = collectViaNodes(routes, srj)
  const currentVia = currentVias.find(
    (candidate) =>
      candidate.routeIndex === via.routeIndex &&
      candidate.pointIndexes.some((pointIndex) =>
        via.pointIndexes.includes(pointIndex),
      ),
  )
  if (!currentVia) return []

  return currentVias.filter(
    (candidate) =>
      candidate.rootConnectionName === currentVia.rootConnectionName &&
      Math.hypot(candidate.x - currentVia.x, candidate.y - currentVia.y) <=
        COORDINATE_EPSILON,
  )
}

const createRoute = (
  name: string,
  root: string | undefined,
  xs: number[],
  ys: number[],
  layers: number[],
): MutableRoute => ({
  connectionName: name,
  rootConnectionName: root,
  traceThickness: 0.15,
  viaDiameter: name.length % 2 === 0 ? 0.4 : 0.6,
  vias: [],
  route: xs.map((x, index) => ({
    x,
    y: ys[index]!,
    z: layers[index]!,
    ...(index === 0 ? { pcb_port_id: `${name}-port` } : {}),
  })),
})

test("root-scoped via collection retains ordered live groups and shared-site boundaries", () => {
  const epsilon = COORDINATE_EPSILON
  const srj: SimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    connections: [],
    obstacles: [],
  }
  const target = createRoute(
    "target",
    "root",
    [0, 0, 2 * epsilon, epsilon, epsilon, 2, 2, 3],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 2, 2, 3, 3],
  )
  const routes: MutableRoute[] = [
    createRoute("unrelated", "other", [0, 0], [0, 0], [0, 1]),
    createRoute("edge", "root", [epsilon, epsilon], [0, 0], [1, 2]),
    target,
    createRoute(
      "outside",
      "root",
      [epsilon * 1.00001, epsilon * 1.00001],
      [0, 0],
      [0, 1],
    ),
    createRoute(
      "diagonal",
      "root",
      [epsilon, epsilon],
      [epsilon, epsilon],
      [1, 2],
    ),
    target,
    createRoute("signed-zero", "root", [-0, 0], [0, -0], [1, 3]),
    createRoute("not-finite", "root", [Infinity, Infinity], [NaN, NaN], [0, 1]),
    createRoute("fallback", undefined, [0, 0], [0, 0], [0, 1]),
  ]
  const staleVia: ViaNode = {
    routeIndex: 2,
    rootConnectionName: "stale-root",
    pointIndexes: [4, 6, 1],
    zLayers: [1],
    x: 9,
    y: 9,
    radius: 0.2,
    movable: true,
    canCanonicalize: true,
  }
  const check = (inputRoutes: MutableRoute[], via: ViaNode): void => {
    const before = structuredClone(inputRoutes)
    for (const allowBlindAndBuriedVias of [false, true]) {
      const settings = { ...srj, allowBlindAndBuriedVias }
      expect(getSameRootViaSite(inputRoutes, via, settings)).toEqual(
        getOriginalSameRootViaSite(inputRoutes, via, settings),
      )
    }
    expect(inputRoutes).toEqual(before)
  }
  check(routes, staleVia)
  expect(
    getSameRootViaSite(routes, staleVia, srj).map((via) => via.routeIndex),
  ).toEqual([1, 2, 5, 6])
  check(routes, { ...staleVia, routeIndex: 5 })
  check(routes, { ...staleVia, pointIndexes: [4] })
  check(routes, { ...staleVia, pointIndexes: [999] })
  for (const routeIndex of [-1, 0.5, 999, NaN, Infinity, -0]) {
    check(routes, { ...staleVia, routeIndex })
  }
  const sparseRoutes = routes.slice()
  delete sparseRoutes[0]
  check(sparseRoutes, staleVia)
  delete sparseRoutes[2]
  check(sparseRoutes, staleVia)

  // Each lookup must observe in-place geometry and root changes. No grouping
  // or site result persists across calls, including an aliased route object.
  target.rootConnectionName = "changed-root"
  for (const point of target.route) point.x += 0.75
  check(routes, staleVia)
  target.route.splice(2, 3)
  check(routes, staleVia)

  let seed = 0x6d18a31b
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let sample = 0; sample < 160; sample += 1) {
    const generated: MutableRoute[] = []
    for (let routeIndex = 0; routeIndex < 12; routeIndex += 1) {
      const xs: number[] = []
      const ys: number[] = []
      const layers: number[] = []
      let x = Math.floor(random() * 3)
      let y = Math.floor(random() * 3)
      for (let pointIndex = 0; pointIndex < 18; pointIndex += 1) {
        if (random() < 0.2) {
          x += 0.25
          y -= 0.25
        } else {
          x += (Math.floor(random() * 5) - 2) * epsilon / 2
          y += (Math.floor(random() * 5) - 2) * epsilon / 2
        }
        xs.push(x)
        ys.push(y)
        layers.push(Math.floor(random() * srj.layerCount))
      }
      generated.push(
        createRoute(
          `route-${routeIndex}`,
          `root-${routeIndex % 4}`,
          xs,
          ys,
          layers,
        ),
      )
    }
    const candidates = collectViaNodes(generated, srj)
    for (const via of candidates) check(generated, via)
    if (candidates[0]) {
      const original = candidates[0]
      generated[original.routeIndex]!.rootConnectionName = "mutated-root"
      generated[original.routeIndex]!.route[original.pointIndexes[0]!]!.x +=
        0.125
      check(generated, original)
    }
  }
})
