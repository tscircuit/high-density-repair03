import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"

type TraceId = string

test("repairs a forbidden own-pad drill without separating connected copper", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    connections: [{ name: "A", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_A", "A"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.28,
    minViaHoleDiameter: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1,
    allowViaInPad: false,
  }
  const routes = cloneRoutes([
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.28,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0.17, y: 0, z: 0 },
        { x: 0.17, y: 0, z: 1 },
        { x: 0.8, y: 0, z: 1 },
      ],
      vias: [{ x: 0.17, y: 0 }],
    },
  ])
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      connection_name: "A",
      route: convertHdRouteToSimplifiedRoute(routes[0]!.route, srj.layerCount, {
        viaDiameter: 0.28,
      }),
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const errors = engine.evaluate(traces).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_placement_error",
    minimum_clearance: 0,
    pcb_pad_ids: ["via_0", "pcb_smtpad_A"],
  })
  expect(errors[0]!.actual_clearance).toBeCloseTo(-0.005, 8)
  expect(
    applyDrcErrorForces(
      srj,
      routes,
      errors,
      new Map<TraceId, number>([["A_0", 0]]),
      1,
      undefined,
      true,
      false,
      true,
      true,
    ),
  ).toBe(true)
  const output = materializeRoutes(routes)[0]!
  expect(output.vias[0]!.x).toBeCloseTo(0.175001, 8)
  expect(output.route[1]).toMatchObject(output.vias[0]!)
  expect(output.route[2]).toMatchObject(output.vias[0]!)
  traces[0]!.route = convertHdRouteToSimplifiedRoute(
    output.route,
    srj.layerCount,
    { viaDiameter: 0.28 },
  )
  expect(engine.evaluate(traces).errors).toHaveLength(0)
  expect(output.vias[0]!.x).toBeLessThan(0.1 + output.viaDiameter / 2)
  for (const allowViaInPad of [true, undefined]) {
    const allowed = new AutoroutingDrcEngine({ ...srj, allowViaInPad })
    const original = structuredClone(traces)
    for (const point of original[0]!.route) {
      if (
        (point.route_type === "wire" || point.route_type === "via") &&
        point.x === output.vias[0]!.x
      )
        point.x = 0.17
    }
    expect(allowed.evaluate(original).errors).toHaveLength(0)
  }
})
