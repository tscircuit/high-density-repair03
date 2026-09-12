import { expect, test } from "bun:test"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcErrors } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"
import type { HighDensityRoute } from "../types/high-density-types"
import type { SimpleRouteJson } from "../types/srj-types"

test("repairs a through-via against Core clearance without changing terminals or widths", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.25,
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top", pcb_port_id: "pcb_port_signal_start" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "pcb_port_signal_end" },
        ],
      },
      {
        name: "via_owner",
        pointsToConnect: [
          { x: 0, y: 2, layer: "inner1", pcb_port_id: "pcb_port_owner_start" },
          { x: 1, y: 2, layer: "inner2", pcb_port_id: "pcb_port_owner_end" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_start" },
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_end" },
      ],
      vias: [],
    },
    {
      connectionName: "via_owner",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 2, z: 1, pcb_port_id: "pcb_port_owner_start" },
        { x: 0, y: 0.35, z: 1 },
        { x: 0, y: 0.35, z: 2 },
        { x: 1, y: 2, z: 2, pcb_port_id: "pcb_port_owner_end" },
      ],
      vias: [{ x: 0, y: 0.35 }],
    },
  ]
  const terminals = routes.map((route) => [route.route[0], route.route.at(-1)])
  const before = getDrcErrors(convertToCircuitJson(srj, routes)).errors
  expect(
    before.some((error) => error.type === "pcb_via_trace_clearance_error"),
  ).toBe(true)

  const solver = new GlobalDrcForceImproveSolver({ srj, hdRoutes: routes })
  solver.solve()
  const after = getDrcErrors(
    convertToCircuitJson(srj, solver.outputHdRoutes),
  ).errors

  expect(after).toEqual([])
  expect(
    checkTracesAreContiguous(convertToCircuitJson(srj, solver.outputHdRoutes)),
  ).toEqual([])
  expect(
    solver.outputHdRoutes.map((route) => [route.route[0], route.route.at(-1)]),
  ).toEqual(terminals)
  expect(solver.outputHdRoutes.map((route) => route.traceThickness)).toEqual([
    0.1, 0.1,
  ])
  expect(solver.outputHdRoutes.map((route) => route.viaDiameter)).toEqual([
    0.3, 0.3,
  ])
})
