import { expect, test } from "bun:test"
import {
  applySafeTraceLayerMoveForError,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

test("local layer moves retain wire vertices next to short planar segments", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [],
  }
  for (const delta of [0.00004, 0.0005, 0.0009]) {
    for (const reversed of [false, true]) {
      for (const rotated of [false, true]) {
        const original: HighDensityRoute = {
          connectionName: "trace",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [-2, 0, delta, 1, 1 + delta, 3].map((x, index) => ({
            x: rotated ? 0 : x,
            y: rotated ? x : 0,
            z: 0,
            ...(index === 0 ? { pcb_port_id: "start" } : {}),
            ...(index === 5 ? { pcb_port_id: "end" } : {}),
          })),
          vias: [],
        }
        if (reversed) original.route.reverse()
        const routes = [structuredClone(original)]
        expect(
          applySafeTraceLayerMoveForError(
            srj,
            routes,
            {
              type: "pcb_trace_error",
              center: rotated ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 },
            },
            0,
            1,
            0,
          ),
        ).toBe(true)
        const output = materializeRoutes(routes)[0]!
        expect(output.route[0]).toEqual(original.route[0])
        expect(output.route.at(-1)).toEqual(original.route.at(-1))
        expect(output.vias).toHaveLength(2)
        for (let index = 1; index < output.route.length; index += 1) {
          const before = output.route[index - 1]!
          const after = output.route[index]!
          if (before.z === after.z) continue
          expect({ x: before.x, y: before.y }).toEqual({
            x: after.x,
            y: after.y,
          })
          expect(output.vias).toContainEqual({ x: before.x, y: before.y })
        }
      }
    }
  }
})
