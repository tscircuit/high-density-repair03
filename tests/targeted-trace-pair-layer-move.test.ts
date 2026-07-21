import { expect, test } from "bun:test"
import {
  applyTracePairLayerMoveForError,
  cloneRoutes,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("moves one exact conflicting trace segment to another layer", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [
      { name: "source_net_1_mst0", pointsToConnect: [] },
      { name: "source_net_2_mst0", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "source_net_1_mst0",
      route: [
        { x: -1, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "source_net_2_mst0",
      route: [
        { x: 0, y: -1, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 1, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyTracePairLayerMoveForError(
    srj,
    routes,
    {
      type: "pcb_trace_error",
      pcb_trace_id: "source_net_1_mst0_0",
      pcb_trace_error_id:
        "overlap_source_net_1_mst0_0_source_net_2_mst0_0",
      center: { x: 0, y: 0 },
    },
    new Map([
      ["source_net_1_mst0_0", 0],
      ["source_net_2_mst0_0", 1],
    ]),
    0,
    2,
  )

  const materialized = materializeRoutes(routes)
  expect(changed).toBe(true)
  expect(materialized[0]?.route.map((point) => point.z)).toEqual([
    1, 2, 2, 1, 1,
  ])
  expect(materialized[0]?.vias).toHaveLength(2)
})
