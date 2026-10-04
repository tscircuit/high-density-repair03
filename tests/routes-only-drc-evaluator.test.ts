import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  AutoroutingDrcEngine,
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

class CountingConnectivityMap extends ConnectivityMap {
  lookupCount = 0

  override getNetConnectedToId(id: string) {
    this.lookupCount += 1
    return super.getNetConnectedToId(id)
  }
}

const createInput = () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "route_a", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pad_a", "pad_a"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route_a",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "route_a",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const connMap = new CountingConnectivityMap({
    net_a: ["route_a"],
    net_b: ["route_b"],
    net_pad: ["pad_a"],
  })
  return { srj, routes, connMap }
}

test("routes-only evaluators skip net normalization and retain repair trace ownership", () => {
  const { srj, routes, connMap } = createInput()
  srj.connections.push(
    { name: "route_b", pointsToConnect: [] },
    { name: "route_a", pointsToConnect: [] },
  )
  routes.unshift({
    ...structuredClone(routes[0]!),
    connectionName: "unmatched",
  })
  routes.push({ ...structuredClone(routes[0]!), connectionName: "route_b" })
  const inputBefore = structuredClone({ srj, routes })
  const evaluator: DrcEvaluator = ({ routes: evaluatedRoutes, traces }) => {
    expect(evaluatedRoutes).toBe(routes)
    if (evaluator.inputMode === "routes-only") expect(traces).toEqual([])
    return {
      errors: [
        { type: "pcb_trace_clearance_error", pcb_trace_id: "route_a_1" },
      ],
      errorsWithCenters: [
        {
          type: "pcb_trace_clearance_error",
          pcb_trace_id: "route_a_1",
          center: { x: 0, y: 1 },
        },
      ],
    }
  }

  const reference = getDrcSnapshot(srj, routes, evaluator, connMap)
  expect(connMap.lookupCount).toBeGreaterThan(0)
  connMap.lookupCount = 0
  evaluator.inputMode = "routes-only"
  const optimized = getDrcSnapshot(srj, routes, evaluator, connMap)
  expect(connMap.lookupCount).toBe(0)
  expect(optimized).toEqual(reference)
  expect([...optimized.traceRouteIndexById]).toEqual([
    ["route_a_0", 1],
    ["route_a_1", 2],
    ["route_b_0", 3],
  ])
  expect({ srj, routes }).toEqual(inputBefore)
})

test("default evaluators retain fresh normalized input and live connectivity changes", () => {
  const { srj, routes, connMap } = createInput()
  const suppliedInputs: SimpleRouteJson[] = []
  const evaluator: DrcEvaluator = ({ srj: input, traces }) => {
    if (!input) throw new Error("Missing evaluator SRJ")
    suppliedInputs.push(input)
    expect(input).not.toBe(srj)
    expect(input.connections[0]?.netConnectionName).toBe(
      connMap.getNetConnectedToId("route_a"),
    )
    expect(input.obstacles[0]?.connectedTo).toEqual([
      ...new Set([
        ...srj.obstacles[0]!.connectedTo,
        connMap.getNetConnectedToId("pad_a")!,
      ]),
    ])
    expect(traces.map((trace) => trace.connection_name)).toEqual([
      connMap.getNetConnectedToId("route_a")!,
      connMap.getNetConnectedToId("route_a")!,
    ])
    input.obstacles[0]!.connectedTo.push("callback_only")
    input.connections[0]!.netConnectionName = "callback_only"
    return []
  }

  getDrcSnapshot(srj, routes, evaluator, connMap)
  connMap.addConnections([["route_a", "pad_a"]])
  srj.obstacles[0]!.connectedTo.push("unknown_id")
  getDrcSnapshot(srj, routes, evaluator, connMap)
  expect(suppliedInputs[0]).not.toBe(suppliedInputs[1])
  expect(suppliedInputs[0]?.obstacles[0]?.connectedTo).not.toBe(
    suppliedInputs[1]?.obstacles[0]?.connectedTo,
  )
  expect(srj.obstacles[0]?.connectedTo).toEqual([
    "pad_a",
    "pad_a",
    "unknown_id",
  ])
  expect(srj.connections[0]?.netConnectionName).toBeUndefined()
})

test("a falsy routes-only result preserves normalized engine and reference fallback", () => {
  const { srj, routes, connMap } = createInput()
  srj.connections.push({ name: "route_b", pointsToConnect: [] })
  routes.push({
    connectionName: "route_b",
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  const missingResult = (() => undefined) as unknown as DrcEvaluator
  let traceNetNames: string[] = []
  const engine = {
    evaluate: (traces: Array<{ connection_name: string }>) => {
      traceNetNames = traces.map((trace) => trace.connection_name)
      return { errors: [], errorsWithCenters: [] }
    },
  } as unknown as AutoroutingDrcEngine

  const referenceEngine = getDrcSnapshot(
    srj,
    routes,
    missingResult,
    connMap,
    engine,
  )
  const referenceNetNames = [...traceNetNames]
  const reference = getDrcSnapshot(srj, routes, undefined, connMap)
  expect(reference.count).toBeGreaterThan(0)
  missingResult.inputMode = "routes-only"
  expect(getDrcSnapshot(srj, routes, missingResult, connMap, engine)).toEqual(
    referenceEngine,
  )
  expect(traceNetNames).toEqual(referenceNetNames)
  expect(traceNetNames).toEqual(["net_a", "net_a", "net_b"])
  expect(getDrcSnapshot(srj, routes, missingResult, connMap)).toEqual(reference)
})

test("portfolio legacy input mode follows the currently selected evaluator", () => {
  const { srj, routes, connMap } = createInput()
  const evaluator: DrcEvaluator = () => []
  evaluator.inputMode = "routes-only"
  const portfolio = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes: routes,
    connMap,
    drcEvaluator: evaluator,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

  connMap.lookupCount = 0
  getDrcSnapshot(srj, routes, portfolio.legacyDrcEvaluator, connMap)
  expect(connMap.lookupCount).toBe(0)
  evaluator.evaluateLegacy = ({ srj: input }) => {
    expect(input?.connections[0]?.netConnectionName).toBe("net_a")
    return []
  }
  getDrcSnapshot(srj, routes, portfolio.legacyDrcEvaluator, connMap)
  expect(connMap.lookupCount).toBeGreaterThan(0)
  evaluator.evaluateLegacy = Object.assign(() => [], {
    inputMode: "routes-only" as const,
  })
  connMap.lookupCount = 0
  getDrcSnapshot(srj, routes, portfolio.legacyDrcEvaluator, connMap)
  expect(connMap.lookupCount).toBe(0)
  evaluator.inputMode = undefined
  evaluator.evaluateLegacy = undefined
  getDrcSnapshot(srj, routes, portfolio.legacyDrcEvaluator, connMap)
  expect(connMap.lookupCount).toBeGreaterThan(0)
})
