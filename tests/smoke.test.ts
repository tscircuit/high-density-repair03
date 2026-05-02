import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { SimpleRouteJson } from "../lib"

test("solves in a single step", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      defaultObstacleMargin: 0.1,
    },
    hdRoutes: [],
    drcEvaluator: () => [],
  })

  solver.step()

  expect(solver.solved).toBe(true)
})

test("improves routes when a DRC evaluator reports conflicts", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [
      { name: "A", pointsToConnect: [] },
      { name: "B", pointsToConnect: [] },
    ],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes = [
    {
      connectionName: "A",
      route: [
        { x: 1, y: 5, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 9, y: 5, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "B",
      route: [
        { x: 5, y: 1, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 5, y: 9, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator = ({
    traces,
  }: {
    traces: Array<{
      connection_name: string
      route: Array<Record<string, unknown>>
    }>
  }) => {
    const horizontal = traces.find((trace) => trace.connection_name === "A")
    const vertical = traces.find((trace) => trace.connection_name === "B")
    const hMid = horizontal?.route.find(
      (segment) => segment.route_type === "wire" && segment.x === 5,
    ) as { x: number; y: number } | undefined
    const vMid = vertical?.route.find(
      (segment) => segment.route_type === "wire" && segment.y === 5,
    ) as { x: number; y: number } | undefined
    if (!hMid || !vMid) return []
    const distance = Math.hypot(hMid.x - vMid.x, hMid.y - vMid.y)
    return distance < 0.15
      ? [
          {
            message: `trace clearance gap: ${distance.toFixed(3)}mm required: 0.150mm`,
            center: { x: (hMid.x + vMid.x) / 2, y: (hMid.y + vMid.y) / 2 },
            pcb_trace_id: "A_0",
          },
        ]
      : []
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator,
  })

  solver.solve()

  const output = solver.getOutput()
  const outputDrc = getDrcSnapshot(srj, output, drcEvaluator)
  expect(outputDrc.count).toBe(0)
  expect(output[0]?.route[1]?.y).not.toBe(5)
})
