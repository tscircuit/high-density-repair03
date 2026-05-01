import { describe, expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"

describe("GlobalDrcForceImproveSolver", () => {
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
    const srj = {
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

  test("preserves width, via diameter, and endpoint port ids in DRC traces", () => {
    const srj = {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [
        {
          name: "A",
          pointsToConnect: [
            { x: 1, y: 1, layer: "top", pcb_port_id: "pcb_port_start" },
            { x: 4, y: 1, layer: "bottom", pcb_port_id: "pcb_port_end" },
          ],
        },
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
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 1, z: 0 },
          { x: 2, y: 1, z: 1 },
          { x: 4, y: 1, z: 1 },
        ],
        vias: [{ x: 2, y: 1 }],
        traceThickness: 0.42,
        viaDiameter: 0.71,
      },
    ]
    let observedTrace: {
      route: Array<Record<string, unknown>>
    } | null = null

    const snapshot = getDrcSnapshot(srj, hdRoutes, ({ traces }) => {
      observedTrace = traces[0] ?? null
      return []
    })

    expect(snapshot.count).toBe(0)
    expect(observedTrace).not.toBeNull()
    if (!observedTrace) {
      throw new Error("expected drcEvaluator to receive a trace")
    }
    const trace = observedTrace as {
      route: Array<Record<string, unknown>>
    }
    expect(trace.route[0]).toEqual({
      route_type: "wire",
      x: 1,
      y: 1,
      width: 0.42,
      layer: "top",
      start_pcb_port_id: "pcb_port_start",
    })
    expect(trace.route[1]).toEqual({
      route_type: "wire",
      x: 2,
      y: 1,
      width: 0.42,
      layer: "top",
    })
    expect(trace.route[2]).toEqual({
      route_type: "via",
      x: 2,
      y: 1,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.71,
    })
    expect(trace.route[3]).toEqual({
      route_type: "wire",
      x: 4,
      y: 1,
      width: 0.42,
      layer: "bottom",
      end_pcb_port_id: "pcb_port_end",
    })
  })

  test("uses minTraceToPadEdgeClearance in default DRC snapshots", () => {
    const baseSrj = {
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect" as const,
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["pcb_smtpad_1"],
        },
      ],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    }
    const hdRoutes = [
      {
        connectionName: "A",
        route: [
          { x: 0.7, y: -1, z: 0 },
          { x: 0.7, y: 1, z: 0 },
        ],
        vias: [],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ]

    expect(getDrcSnapshot(baseSrj, hdRoutes).count).toBe(0)
    expect(
      getDrcSnapshot(
        {
          ...baseSrj,
          minTraceToPadEdgeClearance: 0.25,
        },
        hdRoutes,
      ).count,
    ).toBeGreaterThan(0)
  })

  test("relaxes solved routes away from pad edges before output", () => {
    const srj = {
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect" as const,
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["pcb_smtpad_1"],
        },
      ],
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.25,
    }
    const hdRoutes = [
      {
        connectionName: "A",
        route: [
          { x: -1.5, y: 0.7, z: 0 },
          { x: -0.75, y: 0.7, z: 0 },
          { x: 0.75, y: 0.7, z: 0 },
          { x: 1.5, y: 0.7, z: 0 },
        ],
        vias: [],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ]
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes,
      drcEvaluator: () => [],
    })

    solver.solve()
    const [route] = solver.getOutput()
    const segmentStart = route!.route[1]!
    const segmentEnd = route!.route[2]!
    const edgeClearance =
      segmentToBoxMinDistance(segmentStart, segmentEnd, srj.obstacles[0]!) -
      route!.traceThickness / 2

    expect(segmentStart.y).toBeGreaterThan(0.7)
    expect(segmentEnd.y).toBeGreaterThan(0.7)
    expect(edgeClearance).toBeGreaterThanOrEqual(
      srj.minTraceToPadEdgeClearance - 1e-6,
    )
  })
})
