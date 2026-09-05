import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  repairFinePitchPadEscapes,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"

const srj: SimpleRouteJson = {
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.05,
  minViaEdgeToPadEdgeClearance: 0.05,
  connections: [],
  obstacles: [0, 0.5].map((x, index) => ({
    type: "rect",
    obstacleId: `pcb_smtpad_${index}`,
    componentId: "bga",
    layers: ["top"],
    center: { x, y: 0 },
    width: 0.2,
    height: 0.2,
    connectedTo: [`pcb_smtpad_${index}`, "foreign"],
  })),
}

const routes: HighDensityRoute[] = [
  {
    connectionName: "escape",
    traceThickness: 0.1,
    viaDiameter: 0.2,
    route: [
      { x: 0.25, y: -1, z: 0, pcb_port_id: "start" },
      { x: 0.08, y: -0.3, z: 0 },
      { x: 0.08, y: 0.3, z: 0 },
      { x: 0.25, y: 1, z: 0 },
      { x: 0.25, y: 1, z: 1 },
      { x: 0.25, y: 1.5, z: 1, pcb_port_id: "end" },
    ],
    vias: [{ x: 0.25, y: 1 }],
  },
  {
    connectionName: "fixed",
    traceThickness: 0.1,
    viaDiameter: 0.2,
    route: [
      { x: 0.8, y: -1, z: 0 },
      { x: 0.8, y: 1, z: 0 },
    ],
    vias: [],
  },
]

const engine = new AutoroutingDrcEngine(srj, { traceClearance: 0.05 })
const drcEvaluator: DrcEvaluator = ({ hdRoutes }) =>
  engine.evaluate(
    hdRoutes!.map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(
        route.route,
        srj.layerCount,
        route,
      ),
    })),
  )

test("repairs a fine-pitch channel while preserving terminals, vias and fixed copper", () => {
  const input = structuredClone(routes)
  const initial = drcEvaluator({ hdRoutes: input, traces: [] })
  expect(
    Array.isArray(initial) ? initial.length : initial.errors.length,
  ).toBeGreaterThan(0)
  const result = repairFinePitchPadEscapes({
    srj,
    routes: input,
    drcEvaluator,
    routeIndexByTraceId: new Map([["trace_0", 0]]),
  })
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  expect(result.routes[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(result.routes[0]!.route.slice(3)).toEqual(input[0]!.route.slice(3))
  expect(result.routes[0]!.vias).toEqual(input[0]!.vias)
  expect(result.routes[1]).toEqual(input[1])
  expect(input).toEqual(routes)
})

test("does not repair a trace omitted from the movable trace map", () => {
  const result = repairFinePitchPadEscapes({
    srj,
    routes,
    drcEvaluator,
    routeIndexByTraceId: new Map(),
  })
  expect(result.routes).toBe(routes)
  expect(result.attemptedCandidateCount).toBe(0)
  expect(result.remainingErrors.length).toBeGreaterThan(0)
})

test("does not run fine-pitch candidates without an explicit fine-pitch policy", () => {
  const result = repairFinePitchPadEscapes({
    srj: { ...srj, minTraceToPadEdgeClearance: undefined },
    routes,
    drcEvaluator,
    routeIndexByTraceId: new Map([["trace_0", 0]]),
  })
  expect(result.routes).toBe(routes)
  expect(result.attemptedCandidateCount).toBe(0)
})
