import { expect, test } from "bun:test"
import { applyDrcErrorForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib/types"

test("local pad repulsion leaves points outside the clearance region unchanged", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0.5, z: 0, pcb_port_id: "start" },
      { x: -1, y: 0.5, z: 0 },
      { x: -0.2, y: 0.12, z: 0 },
      { x: 1, y: 0.5, z: 0 },
      { x: 2, y: 0.5, z: 0, pcb_port_id: "end" },
    ],
  }
  const input: HighDensityRoute = structuredClone(route)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.1,
        connectedTo: ["pcb_smtpad_obstacle", "pad_net"],
      },
    ],
  }
  const changed: boolean = applyDrcErrorForces(
    srj,
    [route],
    [
      {
        type: "pcb_trace_error",
        pcb_trace_id: "signal_0",
        message: "PCB trace signal_0 is too close to pcb_smtpad",
        center: { x: -0.15, y: 0.095 },
      },
    ],
    new Map([["signal_0", 0]]),
    1,
  )
  expect(changed).toBe(true)
  expect(route.route[2]).not.toEqual(input.route[2])
  for (const index of [0, 1, 3, 4]) {
    expect(route.route[index]).toEqual(input.route[index])
  }
})
