import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  applyDrcErrorForces,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("preserves a via when a preceding terminal detour shifts its point indices", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 3, maxY: 3 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    connections: [
      { name: "signal", pointsToConnect: [] },
      { name: "blocker", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.51,
        connectedTo: ["signal", "P1"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 3, pcb_port_id: "P1" },
        { x: 0.2, y: 0, z: 3 },
        { x: 0.2, y: -0.25, z: 3 },
        { x: 0.45, y: 0.1, z: 3 },
        { x: 0.45, y: 0.1, z: 0 },
        { x: 2, y: 0, z: 0, pcb_port_id: "P2" },
      ],
      vias: [{ x: 0.45, y: 0.1 }],
    },
    {
      connectionName: "blocker",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.31, y: 1, z: 0 },
        { x: 0.31, y: 0.12, z: 0 },
        { x: 0.31, y: 0.12, z: 3 },
        { x: 1.2, y: 0.12, z: 3 },
      ],
      vias: [{ x: 0.31, y: 0.12 }],
    },
  ]
  const original = structuredClone(routes)
  const engine = new AutoroutingDrcEngine(srj)
  const snapshot = getDrcSnapshot(srj, routes, undefined, undefined, engine)
  const error = snapshot.errors.find(
    (candidate) =>
      candidate.pcb_trace_id === "signal_0" &&
      String(candidate.message).includes("pcb_via"),
  )
  expect(error).toBeDefined()

  expect(
    applyDrcErrorForces(
      srj,
      routes,
      [error!],
      snapshot.traceRouteIndexById,
      1,
      undefined,
      true,
      false,
      false,
      false,
    ),
  ).toBe(true)
  const repaired = materializeRoutes(routes)
  expect(repaired[0]!.route.length).toBeGreaterThan(original[0]!.route.length)
  for (const [index, route] of repaired.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
    expect(route.vias).toHaveLength(original[index]!.vias.length)
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
      const start = route.route[pointIndex - 1]!
      const end = route.route[pointIndex]!
      if (start.z === end.z) continue
      expect({ x: start.x, y: start.y }).toEqual({ x: end.x, y: end.y })
      expect(route.vias).toContainEqual({ x: start.x, y: start.y })
    }
  }
})
