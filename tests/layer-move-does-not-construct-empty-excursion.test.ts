import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { applySafeTraceLayerMoveForError } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a layer move cannot construct an empty excursion when its new via sites coincide", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "route-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-net", "pcb_smtpad_foreign"],
      },
    ],
  }
  const input: HighDensityRoute = {
    connectionName: "route-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-1, 0, 0.1, 1].map((x) => ({ x, y: 0, z: 0 })),
    vias: [],
  }
  const routes = [structuredClone(input)]
  // Both ends of this short span project to the same valid pad-clear site.
  // Emitting old-layer → new-layer → old-layer there would add only a stub.
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      routes,
      { error_type: "pcb_trace_error", center: { x: 0.05, y: 0 } },
      0,
      1,
      0,
    ),
  ).toBe(false)
  expect(routes).toEqual([input])

  // Coincident via endpoints alone do not make a span empty: distinct
  // interior geometry must still be retained on the requested layer.
  const nonempty = [
    {
      ...input,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0.1, y: 0, z: 0 },
      ],
    },
  ]
  const endpoints = [
    structuredClone(nonempty[0]!.route[0]),
    structuredClone(nonempty[0]!.route.at(-1)),
  ]
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      nonempty,
      { error_type: "pcb_trace_error", center: { x: 0.5, y: 0.5 } },
      0,
      1,
      "full",
    ),
  ).toBe(true)
  expect(nonempty[0]!.route[0]).toEqual(endpoints[0])
  expect(nonempty[0]!.route.at(-1)).toEqual(endpoints[1])
  expect(
    nonempty[0]!.route.some((point, index, points) => {
      const previous = points[index - 1]
      return (
        previous?.z === 1 &&
        point.z === 1 &&
        (previous.x !== point.x || previous.y !== point.y)
      )
    }),
  ).toBe(true)
})
