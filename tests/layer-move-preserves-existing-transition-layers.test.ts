import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import {
  applySafeTraceLayerMoveForError,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("an existing transition cannot silently acquire an attachment on a newly occupied layer", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "own-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.7,
        layers: ["bottom"],
        connectedTo: ["own-net", "pcb_smtpad_own"],
      },
    ],
  }
  const input: HighDensityRoute = {
    connectionName: "own-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const error = { error_type: "pcb_trace_error", center: { x: 0.5, y: 0 } }
  const blockedRoutes = [structuredClone(input)]
  expect(
    applySafeTraceLayerMoveForError(srj, blockedRoutes, error, 0, 3, 0),
  ).toBe(false)
  expect(blockedRoutes).toEqual([input])

  // The old top-layer attachment is still legal: only newly occupied bottom
  // copper is checked, and the existing via must not be moved to another site.
  const originalAttachment = {
    ...srj,
    obstacles: srj.obstacles.map((pad) => ({ ...pad, layers: ["top"] })),
  }
  const allowedRoutes = [structuredClone(input)]
  expect(
    applySafeTraceLayerMoveForError(
      originalAttachment,
      allowedRoutes,
      error,
      0,
      3,
      0,
    ),
  ).toBe(true)
  const output = materializeRoutes(allowedRoutes)[0]!
  expect(output.vias).toContainEqual({ x: 0, y: 0 })
  expect(output.route[0]).toEqual(input.route[0])
  expect(output.route.at(-1)).toEqual(input.route.at(-1))
  for (let index = 1; index < output.route.length; index += 1) {
    const previous = output.route[index - 1]!
    const point = output.route[index]!
    if (previous.z === point.z) continue
    expect({ x: point.x, y: point.y }).toEqual({ x: previous.x, y: previous.y })
  }

  // Returning the adjacent span to the preceding layer removes this
  // transition rather than manufacturing a replacement via at its old site.
  const collapsed = [structuredClone(input)]
  expect(
    applySafeTraceLayerMoveForError(
      originalAttachment,
      collapsed,
      error,
      0,
      0,
      0,
    ),
  ).toBe(true)
  expect(materializeRoutes(collapsed)[0]!.vias).not.toContainEqual({
    x: 0,
    y: 0,
  })
})
