import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { findPadClearanceViaPosition } from "../lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("new via geometry respects rotated pads, round holes, and the full-radius board inset", () => {
  const route: HighDensityRoute = {
    connectionName: "route-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [],
    vias: [],
  }
  const base: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.05,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [{ name: "route-net", pointsToConnect: [] }],
    obstacles: [],
  }
  for (const obstacle of [
    {
      type: "rect" as const,
      center: { x: 0, y: 0 },
      width: 1,
      height: 0.2,
      ccwRotationDegrees: 45,
      layers: ["top"],
      connectedTo: ["foreign-net", "pcb_smtpad_rotated"],
    },
    {
      type: "rect" as const,
      center: { x: 0, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top", "bottom"],
      connectedTo: ["foreign-net", "pcb_plated_hole_round"],
    },
  ]) {
    const srj = { ...base, obstacles: [obstacle] }
    const point = findPadClearanceViaPosition(
      srj,
      route,
      { x: 0, y: 0 },
      0.15,
      [0, 1],
    )!
    expect(point).toBeDefined()
    const output = [
      {
        ...route,
        route: [
          { ...point, z: 0 },
          { ...point, z: 1 },
        ],
        vias: [point],
      },
    ]
    expect(
      getDrcSnapshot(
        srj,
        output,
        undefined,
        undefined,
        new AutoroutingDrcEngine(srj),
      ).count,
    ).toBe(0)
    const expectedDistance = obstacle.layers.length > 1 ? 0.4 : 0.35
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(expectedDistance, 5)
  }
  expect(
    findPadClearanceViaPosition(base, route, { x: 1, y: 1 }, 0.15, [0, 1]),
  ).toEqual({ x: 0.8, y: 0.8 })
  const blocked = {
    ...base,
    obstacles: [
      {
        type: "rect" as const,
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["bottom"],
        connectedTo: ["foreign-net"],
      },
    ],
  }
  expect(
    findPadClearanceViaPosition(blocked, route, { x: 0, y: 0 }, 0.15, [0, 1]),
  ).toBeUndefined()
  const fourLayers = { ...blocked, layerCount: 4 }
  const preferred = { x: 0, y: 0 }
  expect(
    findPadClearanceViaPosition(fourLayers, route, preferred, 0.15, [0, 1]),
  ).toBe(preferred)
  expect(
    findPadClearanceViaPosition(fourLayers, route, preferred, 0.15, [0, 3]),
  ).toBeUndefined()
})
