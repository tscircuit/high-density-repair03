import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  repairFinePitchPadEscapes,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import capture from "./fixtures/pedometer-bga-pad-escape.json"

test("repairs the pedometer BGA pad crossing captured before Pipeline9 joint repair", () => {
  const srj = capture.srj as SimpleRouteJson
  const routes = structuredClone(capture.routes) as HighDensityRoute[]
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: srj.minTraceToPadEdgeClearance,
    viaToPadClearance: srj.minViaEdgeToPadEdgeClearance,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
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
  const initial = drcEvaluator({ hdRoutes: routes, traces: [] })
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]!.message).toContain("pcb_smtpad_34")
  const result = repairFinePitchPadEscapes({
    srj,
    routes,
    drcEvaluator,
    routeIndexByTraceId: new Map([["trace_0", 0]]),
  })
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
  expect(result.routes[0]!.vias).toEqual(routes[0]!.vias)
  expect(routes).toEqual(capture.routes)
})
