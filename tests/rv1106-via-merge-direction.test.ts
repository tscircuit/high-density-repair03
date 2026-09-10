import { expect, test } from "bun:test"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { AutoroutingDrcEngine } from "../lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  collectViaNodes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { loadBoard } from "./fixtures/rv1106-phased-repair/loadBoard"
import { expectSnapshot } from "./fixtures/rv1106-phased-repair/expectSnapshot"

test("RV1106 via merge candidates retain the full phased board", async () => {
  const input = loadBoard()
  const engine = new AutoroutingDrcEngine(input.srj, {
    ...RELAXED_DRC_OPTIONS,
    connMap: input.connMap,
  })
  const before = getDrcSnapshot(
    input.srj,
    input.hdRoutes,
    undefined,
    input.connMap,
    engine,
  )
  const error = before.errors.find(
    (candidate) =>
      Array.isArray(candidate.pcb_via_ids) &&
      candidate.pcb_via_ids.includes("via_171") &&
      candidate.pcb_via_ids.includes("via_172"),
  )!
  expect(error).toBeDefined()
  expect(error.pcb_via_pair_net_relation).toBe("same_net")
  expect(before.count).toBe(147)
  let bestRoutes = input.hdRoutes
  let bestCount = before.count
  for (const scale of [1, 1.75, -1]) {
    const routes = cloneRoutes(input.hdRoutes)
    applyDrcErrorForces(
      input.srj,
      routes,
      [error],
      before.traceRouteIndexById,
      scale,
      input.connMap,
      true,
      true,
    )
    const candidate = materializeRoutes(routes)
    const snapshot = getDrcSnapshot(
      input.srj,
      candidate,
      undefined,
      input.connMap,
      engine,
    )
    if (snapshot.count < bestCount) {
      bestRoutes = candidate
      bestCount = snapshot.count
    }
  }
  expect(bestCount).toBe(147)
  expect(bestRoutes).toHaveLength(input.hdRoutes.length)
  for (const [index, route] of bestRoutes.entries()) {
    expect(route.route[0]).toEqual(input.hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(input.hdRoutes[index]!.route.at(-1))
  }
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    ...input,
    autoroutingDrcEngine: engine,
  })
  solver.outputHdRoutes = bestRoutes
  const graphics = solver.visualize()
  graphics.title = `RV1106 full board: ${bestCount} repair03 DRC reports`
  expectSnapshot({
    graphics,
    name: "rv1106-via-merge-direction",
    relaxedDrcCount: bestCount,
  })
  const insideDetail = (point: { x: number; y: number }) =>
    point.x >= -8 && point.x <= -7 && point.y >= -2.7 && point.y <= -1.7
  expectSnapshot({
    graphics: {
      coordinateSystem: graphics.coordinateSystem,
      title: "RV1106 via merge detail",
      lines: graphics.lines?.filter((line) => line.points.every(insideDetail)),
      circles: collectViaNodes(bestRoutes)
        .filter(insideDetail)
        .map((via) => ({
          center: { x: via.x, y: via.y },
          radius: via.radius,
          stroke: "#111827",
          fill: "rgba(17, 24, 39, 0.15)",
        })),
      rects: [
        {
          center: { x: -7.5, y: -2.2 },
          width: 1,
          height: 1,
          stroke: "#64748b",
          fill: "transparent",
        },
      ],
    },
    name: "rv1106-via-merge-detail",
  })
})
