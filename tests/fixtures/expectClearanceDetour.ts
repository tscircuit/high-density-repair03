import { expect } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "checks-reference"
import { AutoroutingDrcEngine } from "../../lib"
import {
  applyTraceClearanceDetourForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../../lib/types"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../../lib/utils/convertHdRouteToSimplifiedRoute"
import { convertToCircuitJson } from "../../lib/utils/convertToCircuitJson"

export const expectClearanceDetour = (
  kind: "pad" | "hole" | "trace" | "via",
): void => {
  const isObstacle = kind === "pad" || kind === "hole"
  for (const scale of [1, 3, 7]) {
    for (const rotation of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      for (const reversed of [false, true]) {
        const transform = (x: number, y: number): { x: number; y: number } => {
          const angle = (rotation * Math.PI) / 2
          return {
            x: scale * (x * Math.cos(angle) - y * Math.sin(angle)) + 2.3,
            y: scale * (x * Math.sin(angle) + y * Math.cos(angle)) - 1.7,
          }
        }
        const srj: SimpleRouteJson = {
          layerCount: 2,
          bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
          minTraceWidth: 0.1 * scale,
          minViaDiameter: 0.3 * scale,
          minTraceToPadEdgeClearance: 0.1 * scale,
          obstacles: isObstacle
            ? [
                {
                  type: "rect",
                  layers: kind === "hole" ? ["top", "bottom"] : ["top"],
                  center: transform(0, 0),
                  width: 0.8 * scale,
                  height: 2 * scale,
                  ccwRotationDegrees: rotation * 90,
                  connectedTo: ["foreign", "pcb_smtpad_foreign"],
                },
              ]
            : [],
          connections: [
            { name: "moving", pointsToConnect: [] },
            ...(!isObstacle ? [{ name: "foreign", pointsToConnect: [] }] : []),
          ],
        }
        const moving: HighDensityRoute = {
          connectionName: "moving",
          traceThickness: 0.23 * scale,
          viaDiameter: 0.3 * scale,
          vias: [],
          route: [
            { ...transform(-4, 0), z: 0, pcb_port_id: "start" },
            { ...transform(0, 0), z: 0 },
            { ...transform(4, 0), z: 0, pcb_port_id: "end" },
          ],
        }
        if (reversed) moving.route.reverse()
        const routes: HighDensityRoute[] = [moving]
        if (!isObstacle)
          routes.push({
            connectionName: "foreign",
            traceThickness: 0.1 * scale,
            viaDiameter: 0.3 * scale,
            route:
              kind === "trace"
                ? [
                    { ...transform(0, -1), z: 0 },
                    { ...transform(0, 1), z: 0 },
                  ]
                : [
                    { ...transform(0, 0), z: 0 },
                    { ...transform(0, 0), z: 1 },
                    { ...transform(0, 2), z: 1 },
                  ],
            vias: kind === "via" ? [transform(0, 0)] : [],
          })
        const engine = new AutoroutingDrcEngine(srj, {
          traceClearance: srj.minTraceToPadEdgeClearance,
          viaClearance: srj.minTraceToPadEdgeClearance,
          includeTraceViaOwnerMetadata: true,
        })
        const before = getDrcSnapshot(srj, routes, undefined, undefined, engine)
        expect(before.count).toBeGreaterThan(0)
        const error = before.errors.find(
          (candidate) => candidate.type === "pcb_trace_error",
        )!
        expect(error).toBeDefined()
        for (const direction of [-1, 1] as const) {
          const candidate = cloneRoutes(routes)
          expect(
            applyTraceClearanceDetourForError(
              srj,
              candidate,
              error,
              before.traceRouteIndexById,
              0,
              direction,
            ),
          ).toBe(true)
          const output = materializeRoutes(candidate)
          // Match the independent checker version pinned by the autorouter.
          const circuitJson = convertToCircuitJson(srj, output.map((route) => ({
            type: "pcb_trace" as const,
            pcb_trace_id: route.connectionName,
            connection_name: route.connectionName,
            route: convertHdRouteToSimplifiedRoute(route.route, srj.layerCount, {
              traceThickness: route.traceThickness,
              viaDiameter: route.viaDiameter,
            }),
          })))
          expect(checkEachPcbTraceNonOverlapping(circuitJson, {
            minSpacing: srj.minTraceToPadEdgeClearance,
          })).toEqual([])
          expect(
            getDrcSnapshot(srj, output, undefined, undefined, engine).count,
          ).toBe(0)
          expect(output[0]!.route[0]).toEqual(moving.route[0])
          expect(output[0]!.route.at(-1)).toEqual(moving.route.at(-1))
          expect(output[0]!.traceThickness).toBe(moving.traceThickness)
          expect(output[0]!.vias).toEqual([])
          expect(output.slice(1)).toEqual(routes.slice(1))
        }
      }
    }
  }
}
