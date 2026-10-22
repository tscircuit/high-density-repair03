import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPhysicalSmtPadOverlaps } from "./fixtures/getPhysicalSmtPadOverlaps"

test("physical pad overlap checks include contacts below the DRC epsilon", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "trace", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  for (const gap of [-0.002, -0.000001, 0, 0.002]) {
    const routes: HighDensityRoute[] = [
      {
        connectionName: "trace",
        route: [
          { x: -1, y: 0.55 + gap, z: 0 },
          { x: 1, y: 0.55 + gap, z: 0 },
        ],
        vias: [],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ]
    const overlaps = getPhysicalSmtPadOverlaps(srj, routes)
    expect(overlaps).toHaveLength(gap < 0 ? 1 : 0)
    if (gap < 0) {
      expect(overlaps[0]!.actual_clearance).toBeCloseTo(gap, 10)
    }
  }
})
