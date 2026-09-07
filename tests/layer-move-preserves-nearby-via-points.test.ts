import { expect, test } from "bun:test"
import {
  applySafeTraceLayerMoveForError,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

test("layer moves preserve short segments adjacent to existing vias", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [],
  }

  for (const delta of [0.00004, 0.0005, 0.0009]) {
    for (const reversed of [false, true]) {
      const original: HighDensityRoute = {
        connectionName: "trace",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -4, y: 0, z: 0, pcb_port_id: "start" },
          { x: -3, y: 0, z: 0 },
          { x: -3, y: 0, z: 1 },
          { x: -1, y: 0, z: 1 },
          { x: -1, y: 0, z: 0 },
          { x: 1 - delta, y: -delta, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0, z: 2 },
          { x: 4, y: 0, z: 2, pcb_port_id: "end" },
        ],
        vias: [{ x: -3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }],
      }
      if (reversed) original.route.reverse()
      const routes = [structuredClone(original)]
      expect(applySafeTraceLayerMoveForError(srj, routes, {
        type: "pcb_trace_error",
        center: { x: -2, y: 0 },
      }, 0, 2, "full")).toBe(true)

      const output = materializeRoutes(routes)[0]!
      expect(output.route[0]).toEqual(original.route[0])
      expect(output.route.at(-1)).toEqual(original.route.at(-1))
      expect(output.route).toContainEqual({ x: 1, y: 0, z: 0, pcb_port_id: undefined })
      expect(output.vias).toContainEqual({ x: 1, y: 0 })
      for (let index = 1; index < output.route.length; index += 1) {
        const start = output.route[index - 1]!
        const end = output.route[index]!
        if (start.z === end.z) continue
        expect({ x: start.x, y: start.y }).toEqual({ x: end.x, y: end.y })
        expect(output.vias).toContainEqual({ x: start.x, y: start.y })
      }
    }
  }
})
