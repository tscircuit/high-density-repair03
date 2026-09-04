import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { findPadClearanceViaPosition } from "../lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("new via construction finds the side escape from opposing pad clearances", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
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
        layers: ["top"],
        connectedTo: ["own-net", "pcb_smtpad_own"],
      },
      {
        type: "rect",
        center: { x: 0.65, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["foreign-net", "pcb_smtpad_foreign"],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "own-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [],
    vias: [],
  }
  const preferred = { x: 0.506, y: 0 }
  const initialRoutes = [
    {
      ...route,
      route: [
        { ...preferred, z: 0 },
        { ...preferred, z: 1 },
      ],
      vias: [preferred],
    },
  ]
  expect(
    getDrcSnapshot(
      srj,
      initialRoutes,
      undefined,
      undefined,
      new AutoroutingDrcEngine(srj),
    ).count,
  ).toBeGreaterThan(0)
  const point = findPadClearanceViaPosition(
    srj,
    route,
    preferred,
    0.15,
    [0, 1],
  )!
  const padDistance = (pad: SimpleRouteJson["obstacles"][number]) =>
    Math.hypot(
      Math.max(Math.abs(point.x - pad.center.x) - pad.width / 2, 0),
      Math.max(Math.abs(point.y - pad.center.y) - pad.height / 2, 0),
    )
  expect(point).toBeDefined()
  expect(Math.abs(point.y)).toBeGreaterThan(0.3)
  expect(padDistance(srj.obstacles[0]!)).toBeGreaterThanOrEqual(0.15)
  expect(padDistance(srj.obstacles[1]!)).toBeGreaterThanOrEqual(0.25)
  // The near side escape is much shorter than going around either whole pad.
  expect(Math.hypot(point.x - preferred.x, point.y - preferred.y)).toBeLessThan(
    0.45,
  )
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
  expect(preferred).toEqual({ x: 0.506, y: 0 })

  const alreadyClear = { x: 1.2, y: 1.2 }
  expect(
    findPadClearanceViaPosition(srj, route, alreadyClear, 0.15, [0, 1]),
  ).toBe(alreadyClear)
})
