import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc"
import {
  getDrcSnapshot,
  hasNewRouteObstacleOverlaps,
  hasNewTraceObstacleOverlaps,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { createViaContactGuardInput } from "./fixtures/viaContactGuard"

test("contact obstacle rejection agrees with complete DRC and preserves evaluation statistics", (): void => {
  const { srj, hdRoutes } = createViaContactGuardInput()
  srj.obstacles = [
    {
      type: "rect",
      obstacleId: "round-pad",
      shape: "circle",
      center: { x: 0, y: 0.4 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["pcb_smtpad_foreign"],
    },
    {
      type: "rect",
      obstacleId: "rotated-pad",
      center: { x: 0.5, y: 0.8 },
      width: 0.6,
      height: 0.3,
      ccwRotationDegrees: 37,
      layers: ["top", "inner1", "inner2", "bottom"],
      connectedTo: ["pcb_plated_hole_other"],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const inputSnapshot = getDrcSnapshot(
    srj,
    hdRoutes,
    undefined,
    undefined,
    engine,
  )
  let rejections = 0
  let accepted = 0
  for (let i = 0; i < 120; i++) {
    const referenceRoutes = [...hdRoutes]
    if (i % 3 === 0) {
      referenceRoutes[0] = structuredClone(hdRoutes[0]!)
      for (const point of referenceRoutes[0]!.route) point.y = 0.4
    }
    const referenceSnapshot = getDrcSnapshot(
      srj,
      referenceRoutes,
      undefined,
      undefined,
      engine,
    )
    const routes = [...referenceRoutes]
    const wireY = (i % 12) * 0.1 - 0.2
    if (i % 3 === 2) {
      routes[0] = structuredClone(referenceRoutes[0]!)
      for (const point of routes[0]!.route) point.y = wireY
    }
    routes[1] = structuredClone(referenceRoutes[1]!)
    const viaX = Math.floor(i / 12) * 0.1 - 0.2
    const viaY = i < 60 ? 0.8 : 2
    for (const point of routes[1]!.route) {
      if (point.x === 0) point.x = viaX
      point.y = viaY
    }
    routes[1]!.vias[0] = { x: viaX, y: viaY }
    routes[1]!.viaDiameter = i % 2 ? 0.3 : 0.5
    const complete = getDrcSnapshot(srj, routes, undefined, undefined, engine)
    const previousStats = engine.lastRunStats
    const previousStatsValue = { ...previousStats }
    const rejected = hasNewRouteObstacleOverlaps({
      srj,
      routes,
      referenceRoutes,
      referenceSnapshot,
      inputSnapshot,
      engine,
    })
    expect(rejected).toBe(hasNewTraceObstacleOverlaps(complete, inputSnapshot))
    expect(engine.lastRunStats).toBe(previousStats)
    expect(previousStats).toEqual(previousStatsValue)
    if (rejected) rejections++
    else accepted++
  }
  expect(rejections).toBeGreaterThan(0)
  expect(accepted).toBeGreaterThan(0)
})
