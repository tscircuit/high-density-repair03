import { expect, test } from "bun:test"
import { TraceContactRepairSolver } from "../lib"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPhysicalPeerPairs } from "./fixtures/peerTraceRepair"

test("contact bridges replace a redundant via excursion without restoring the short", () => {
  const candidate: HighDensityRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [-2, -1, 1, 2].map((x, index) => ({
        x,
        y: 0,
        z: 0,
        ...(index === 0 || index === 3 ? { pcb_port_id: `a${index}` } : {}),
      })),
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: -1, z: 0, pcb_port_id: "b0" },
        { x: 0, y: 1, z: 0, pcb_port_id: "b1" },
      ],
    },
    {
      connectionName: "independent",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: -1.5, y: 0.8 },
        { x: -0.5, y: 0.8 },
      ],
      route: [
        { x: -1.8, y: 0.8, z: 0, pcb_port_id: "i0" },
        { x: -1.5, y: 0.8, z: 0 },
        { x: -1.5, y: 0.8, z: 1 },
        { x: -0.5, y: 0.8, z: 1 },
        { x: -0.5, y: 0.8, z: 0 },
        { x: -0.2, y: 0.8, z: 0, pcb_port_id: "i1" },
      ],
    },
  ]
  const original = structuredClone(candidate)
  original[0]!.route.splice(
    1,
    2,
    { x: -0.6, y: 0, z: 0 },
    { x: -0.6, y: 0, z: 1 },
    { x: 0.6, y: 0, z: 1 },
    { x: 0.6, y: 0, z: 0 },
  )
  original[0]!.vias = [
    { x: -0.6, y: 0 },
    { x: 0.6, y: 0 },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: candidate.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const solver = new TraceContactRepairSolver({
    srj,
    hdRoutes: candidate,
    inputHdRoutes: original,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    drcEvaluator: () => ({ errors: [], errorsWithCenters: [] }),
  })
  solver.solve()
  const output = solver.getOutput()
  expect(solver.stats.traceContactRepairAccepted).toBe(true)
  expect(getPhysicalPeerPairs(output)).toEqual([])
  expect(output.reduce((sum, route) => sum + route.vias.length, 0)).toBe(2)
  expect(output[2]!.vias).toEqual([])
  for (let index = 0; index < candidate.length; index++) {
    expect(output[index]!.route[0]).toEqual(candidate[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(candidate[index]!.route.at(-1))
  }
})
