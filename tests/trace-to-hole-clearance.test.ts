import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

test("indexed hole clearance uses the normal obstacle distance and DRC tolerance", () => {
  for (const useCaches of [false, true]) {
    for (const clearance of [undefined, 0, 0.05, 0.2, 0.5]) {
      for (const shape of ["circle", undefined] as const) {
        const height = shape === "circle" ? 2 : 1
        const srj: SimpleRouteJson = {
          bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
          connections: [{ name: "signal", pointsToConnect: [] }],
          layerCount: 2,
          minTraceWidth: 0.2,
          minTraceToPadEdgeClearance: 0.35,
          minTraceToHoleEdgeClearance: clearance,
          obstacles: [
            {
              obstacleId: "physical_hole",
              type: "rect",
              isNonPlatedHole: true,
              shape,
              width: 2,
              height,
              center: { x: 0, y: 0 },
              layers: ["top", "bottom"],
              connectedTo: [],
            },
          ],
        }
        // Pad clearance is supplied through the existing engine option.
        // Holes select their independent SRJ rule, with the same fallback.
        for (const isNonPlatedHole of [true, false]) {
          srj.obstacles[0]!.isNonPlatedHole = isNonPlatedHole
          srj.obstacles[0]!.connectedTo = isNonPlatedHole
            ? []
            : ["pcb_plated_hole_pad"]
          const before = JSON.stringify(srj)
          const engine = new AutoroutingDrcEngine(srj, {
            traceClearance: srj.minTraceToPadEdgeClearance,
            cacheStaticObstacleNetMembership: useCaches,
            cacheImmutableTraceGeometry: useCaches,
            useTransientDynamicQueryMarkers: useCaches,
            useConservativeRectObstaclePrecheck: useCaches,
          })
          const minimum = isNonPlatedHole ? (clearance ?? 0.35) : 0.35
          for (const layer of ["top", "bottom"]) {
            // Both rules use the engine's existing 0.005mm scoring tolerance.
            for (const deficit of [0, 0.004, 0.01]) {
              const y = height / 2 + 0.1 + minimum - deficit
              const traces: SimplifiedPcbTraces = [
                {
                  type: "pcb_trace",
                  pcb_trace_id: "signal",
                  connection_name: "signal",
                  route: [
                    { route_type: "wire", x: -3, y, width: 0.2, layer },
                    { route_type: "wire", x: 3, y, width: 0.2, layer },
                  ],
                },
              ]
              const errors = engine.evaluate(traces).errors
              expect(engine.evaluate(traces).errors).toEqual(errors)
              expect(errors).toHaveLength(deficit > 0.005 ? 1 : 0)
              if (errors.length) {
                expect(errors[0]!.minimum_clearance).toBe(minimum)
                expect(errors[0]!.actual_clearance).toBeCloseTo(
                  minimum - deficit,
                  8,
                )
              }
            }
          }
          expect(JSON.stringify(srj)).toBe(before)
        }
      }
    }
  }
})
