import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyBroadRepulsionForces,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import fixtureJson from "./fixtures/bugreport91-broad-repulsion-clearance/input.json" with {
  type: "json",
}

const fixture = fixtureJson as {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
}
const VIA_ROUTE_NAME =
  "source_trace_104__source_trace_105__source_trace_106__source_trace_108__source_trace_111_mst4"
const TRACE_ROUTE_NAME =
  "source_trace_121__source_trace_122__source_trace_123__source_trace_125__source_trace_127_mst1"

const createConnectivityMap = (srj: SimpleRouteJson): ConnectivityMap => {
  const connMap = new ConnectivityMap({})
  for (const connection of srj.connections) {
    const rootConnectionNames = (
      connection as typeof connection & { __rootConnectionNames?: string[] }
    ).__rootConnectionNames
    connMap.addConnections([[connection.name, ...(rootConnectionNames ?? [])]])
  }
  for (const obstacle of srj.obstacles) {
    connMap.addConnections([
      [obstacle.obstacleId, ...obstacle.connectedTo].filter(
        Boolean,
      ) as string[],
    ])
  }
  return connMap
}

const getTargetClearance = (routes: HighDensityRoute[]): number => {
  const viaRoute = routes.find(
    (route) => route.connectionName === VIA_ROUTE_NAME,
  )!
  const traceRoute = routes.find(
    (route) => route.connectionName === TRACE_ROUTE_NAME,
  )!
  const via = viaRoute.vias[0]!
  let centerlineDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < traceRoute.route.length - 1; index += 1) {
    centerlineDistance = Math.min(
      centerlineDistance,
      pointToSegmentDistance(
        via,
        traceRoute.route[index]!,
        traceRoute.route[index + 1]!,
      ),
    )
  }
  return (
    centerlineDistance -
    viaRoute.viaDiameter / 2 -
    traceRoute.traceThickness / 2
  )
}

test("broad repulsion preserves via-to-trace clearance while escaping pads", () => {
  const connMap = createConnectivityMap(fixture.srj)
  const outputRoutes = applyBroadRepulsionForces(
    fixture.srj,
    fixture.hdRoutes,
    1,
    3,
    connMap,
  )
  const outputDrc = getDrcSnapshot(
    fixture.srj,
    outputRoutes,
    undefined,
    connMap,
  )

  expect(getTargetClearance(fixture.hdRoutes)).toBeGreaterThanOrEqual(0.1)
  expect(getTargetClearance(outputRoutes)).toBeGreaterThanOrEqual(0.1)
  expect(outputDrc.count).toBe(0)
})
