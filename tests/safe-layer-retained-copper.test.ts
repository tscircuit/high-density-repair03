import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { hasNewForeignCopperOverlap } from "../lib/solvers/GlobalDrcForceImproveSolver/hasNewForeignCopperOverlap"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("safe layer moves retain existing split copper without adding foreign contacts", () => {
  for (const scenario of [0, 30, 45, 90].flatMap((angle) =>
    [-1, 1].flatMap((side) =>
      [
        { x: 0, y: 0 },
        { x: 13.7, y: -7.3 },
      ].map((offset) => ({
        angle,
        side,
        offset,
      })),
    ),
  )) {
    const { offset, side } = scenario
    const angle = (scenario.angle * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const point = (
      x: number,
      y: number,
      z = 0,
    ): HighDensityRoute["route"][number] => ({
      x: x * cos - y * sin + offset.x,
      y: x * sin + y * cos + offset.y,
      z,
    })
    const route = (
      name: string,
      points: HighDensityRoute["route"],
      width = 0.1,
    ): HighDensityRoute => ({
      connectionName: name,
      traceThickness: width,
      viaDiameter: 0.3,
      route: points,
      vias: [],
    })
    const moving = route("signal", [
      { ...point(-2, 0), pcb_port_id: "start" },
      { ...point(2, 0), pcb_port_id: "end" },
    ])
    const foreign = route("foreign", [
      point(side * 1.95, -1),
      point(side * 1.95, 1),
    ])
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: {
        minX: offset.x - 4,
        maxX: offset.x + 4,
        minY: offset.y - 2,
        maxY: offset.y + 2,
      },
      connections: [],
      obstacles: [-2, 2].map((x, i) => ({
        type: "oval",
        center: point(x, 0),
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal", i ? "end" : "start"],
      })),
    }
    const routes = cloneRoutes([moving, foreign])
    expect(
      applySafeTraceLayerMoveForError(
        srj,
        routes,
        { type: "pcb_trace_error", center: point(0, 0) },
        0,
        1,
        "full",
      ),
    ).toBe(true)
    expect(routes[0]!.route[0]).toEqual(moving.route[0]!)
    expect(routes[0]!.route.at(-1)).toEqual(moving.route.at(-1)!)
    expect(routes[1]).toEqual(foreign)
    expect(
      hasNewForeignCopperOverlap(moving, routes[0]!, [moving, foreign]),
    ).toBe(false)

    const extension = route("signal", [point(-2, 0), point(2.1, 0)])
    expect(
      hasNewForeignCopperOverlap(moving, extension, [
        route("foreign", [point(2.12, -1), point(2.12, 1)]),
      ]),
    ).toBe(true)
    const widened = route("signal", [point(-1, 0), point(1, 0)], 0.14)
    expect(
      hasNewForeignCopperOverlap(moving, widened, [
        route("foreign", [point(-1, 0.11), point(1, 0.11)]),
      ]),
    ).toBe(true)
    const displaced = route("signal", [point(-1, 1e-8), point(1, 1e-8)])
    expect(
      hasNewForeignCopperOverlap(moving, displaced, [
        route("foreign", [point(-1, 0.100000005), point(1, 0.100000005)]),
      ]),
    ).toBe(true)
    const narrowed = route("signal", [point(-1, 0), point(1, 0)], 0.08)
    expect(
      hasNewForeignCopperOverlap(moving, narrowed, [
        route("foreign", [point(0, -1), point(0, 1)]),
      ]),
    ).toBe(false)
  }
})
