import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { hasNewViaPadOverlap } from "../lib/solvers/GlobalDrcForceImproveSolver/hasNewViaPadOverlap"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("partial layer changes keep new interior vias outside pad copper", () => {
  for (const offset of [{ x: 0, y: 0 }, { x: 17.3, y: -8.7 }]) {
    const point = (x: number, z = 0): HighDensityRoute["route"][number] => ({
      x: x + offset.x,
      y: offset.y,
      z,
    })
    const srj: SimpleRouteJson = {
      bounds: {
        minX: offset.x - 5,
        maxX: offset.x + 5,
        minY: offset.y - 5,
        maxY: offset.y + 5,
      },
      layerCount: 3,
      minTraceWidth: 0.1,
      obstacles: [
        {
          type: "rect",
          center: { x: offset.x + 2, y: offset.y },
          width: 0.6,
          height: 0.6,
          layers: ["top"],
          zLayers: [],
          connectedTo: ["signal", "end"],
        },
      ],
      connections: [],
    }
    const route = (split: number): HighDensityRoute => ({
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { ...point(-3), pcb_port_id: "start" },
        point(-2),
        point(0),
        point(split),
        { ...point(2), pcb_port_id: "end" },
      ],
      vias: [],
    })
    const error = {
      type: "pcb_trace_error",
      center: { x: offset.x + 0.5, y: offset.y },
    }
    for (const split of [1.8, 1.6]) {
      const routes = cloneRoutes([route(split)])
      const before = structuredClone(routes)
      expect(
        applySafeTraceLayerMoveForError(srj, routes, error, 0, 1, 0),
      ).toBe(false)
      expect(routes).toEqual(before)
    }
    const legal = cloneRoutes([route(1.54)])
    expect(
      applySafeTraceLayerMoveForError(srj, legal, error, 0, 1, 0),
    ).toBe(true)
    expect(legal[0]!.route[0]).toEqual(route(1.54).route[0]!)
    expect(legal[0]!.route.at(-1)).toEqual(route(1.54).route.at(-1)!)
    expect(hasNewViaPadOverlap(srj, route(1.54), legal[0]!)).toBe(false)

    const existing: HighDensityRoute = {
      ...route(1.8),
      route: [point(0), point(1.8), point(1.8, 1), point(2, 1)],
    }
    expect(hasNewViaPadOverlap(srj, existing, existing)).toBe(false)
    const extended: HighDensityRoute = {
      ...existing,
      route: [point(0, 2), point(1.8, 2), point(1.8), point(2)],
    }
    expect(
      hasNewViaPadOverlap(
        { ...srj, obstacles: [{ ...srj.obstacles[0]!, layers: ["bottom"] }] },
        existing,
        extended,
      ),
    ).toBe(true)
    const declared = cloneRoutes([route(1.54)])
    expect(
      applySafeTraceLayerMoveForError(
        { ...srj, minViaEdgeToPadEdgeClearance: 0.05 },
        declared,
        error,
        0,
        1,
        0,
      ),
    ).toBe(false)
  }
})
