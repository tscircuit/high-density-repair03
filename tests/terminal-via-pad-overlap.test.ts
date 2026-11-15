import { expect, test } from "bun:test"
import {
  applyTerminalViaRelocationForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("terminal via relocation clears pad overlaps at either route end", (): void => {
  for (const endpointSide of ["start", "end"] as const) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: -1.5, y: 0 },
          width: 0.4,
          height: 0.4,
          connectedTo: ["trace", "start"],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: -0.5, y: 0 },
          width: 0.4,
          height: 0.4,
          connectedTo: ["pcb_smtpad_foreign"],
        },
      ],
      connections: [
        {
          name: "trace",
          pointsToConnect: [
            { x: -1.5, y: 0, layer: "top", pointId: "start" },
            { x: 1.5, y: 0, layer: "bottom", pointId: "end" },
          ],
        },
      ],
    }
    const route: HighDensityRoute = {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1.5, y: 0, z: 0, pcb_port_id: "start" },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1.5, y: 0, z: 1, pcb_port_id: "end" },
      ],
      vias: [{ x: 0, y: 0 }],
    }
    if (endpointSide === "end") route.route.reverse()
    const before = getDrcSnapshot(srj, [route])
    const candidateRoutes = cloneRoutes([route])
    const changed = applyTerminalViaRelocationForError(
      srj,
      candidateRoutes,
      {
        type: "pcb_trace_error",
        pcb_pad_id: "pcb_smtpad_foreign",
        pcb_trace_id: "trace_0",
        center: { x: -0.5, y: 0 },
      },
      new Map([["trace_0", 0]]),
      endpointSide,
    )
    const materialized = materializeRoutes(candidateRoutes)
    const after = getDrcSnapshot(srj, materialized)

    expect(changed).toBe(true)
    expect(before.count).toBeGreaterThan(0)
    expect(after.count).toBe(0)
    expect(materialized[0]?.route.map((point) => point.z)).toEqual(
      endpointSide === "start" ? [0, 1, 1, 1] : [1, 1, 1, 0],
    )
    const terminalIndex = endpointSide === "start" ? 0 : route.route.length - 1
    expect(materialized[0]?.route[terminalIndex]).toEqual(
      route.route[terminalIndex],
    )
    expect(materialized[0]?.vias).toEqual([{ x: -1.5, y: 0 }])
  }
})
