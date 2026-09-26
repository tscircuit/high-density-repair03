import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

const gaps = [0.1, 0.3, 0.6]
const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.12,
  minTraceToPadEdgeClearance: 0.35,
  bounds: { minX: -3, maxX: 4, minY: -1, maxY: 2 },
  connections: [{ name: "signal", pointsToConnect: [] }],
  obstacles: [
    {
      obstacleId: "round_hole",
      type: "rect",
      isNonPlatedHole: true,
      shape: "circle",
      center: { x: -1.3, y: 0 },
      width: 1.2,
      height: 1.2,
      layers: ["top", "bottom"],
      connectedTo: [],
    },
    {
      obstacleId: "rectangular_hole",
      type: "rect",
      isNonPlatedHole: true,
      center: { x: 1.3, y: 0 },
      width: 1.2,
      height: 1.2,
      layers: ["top", "bottom"],
      connectedTo: [],
    },
  ],
}
const traces: SimplifiedPcbTraces = gaps.map((gap, index) => ({
  type: "pcb_trace",
  pcb_trace_id: `signal_${index}`,
  connection_name: "signal",
  route: [
    {
      route_type: "wire",
      x: -2.5,
      y: 0.6 + 0.06 + gap,
      width: 0.12,
      layer: "top",
    },
    {
      route_type: "wire",
      x: 2.5,
      y: 0.6 + 0.06 + gap,
      width: 0.12,
      layer: "top",
    },
  ],
}))

test("indexed DRC highlights physical hole gaps below the selected clearance", async () => {
  const before = structuredClone({ srj, traces })
  const panels: GraphicsObject[] = []
  for (const clearance of [0, 0.2, 0.5]) {
    const engine = new AutoroutingDrcEngine(
      { ...srj, minTraceToHoleEdgeClearance: clearance },
      {
        traceClearance: srj.minTraceToPadEdgeClearance,
      },
    )
    const { errors } = engine.evaluate(traces)
    const failingTraceIds = new Set(errors.map((error) => error.pcb_trace_id))
    expect(failingTraceIds).toEqual(
      new Set(
        traces
          .filter((_, i) => gaps[i]! < clearance)
          .map((trace) => trace.pcb_trace_id),
      ),
    )
    expect(errors).toHaveLength(
      gaps.filter((gap) => gap < clearance).length * srj.obstacles.length,
    )
    for (const error of errors) {
      const index = traces.findIndex(
        (trace) => trace.pcb_trace_id === error.pcb_trace_id,
      )
      expect(error.minimum_clearance).toBe(clearance)
      expect(error.actual_clearance).toBeCloseTo(gaps[index]!, 8)
    }
    panels.push({
      coordinateSystem: "cartesian",
      rects: [
        {
          center: { x: 0.5, y: 0.5 },
          width: 7,
          height: 3,
          fill: "transparent",
          stroke: "#cbd5e1",
        },
        ...srj.obstacles
          .filter((hole) => hole.shape !== "circle")
          .map((hole) => ({
            center: hole.center,
            width: hole.width,
            height: hole.height,
            fill: "#e2e8f0",
            stroke: "#475569",
          })),
      ],
      circles: srj.obstacles
        .filter((hole) => hole.shape === "circle")
        .map((hole) => ({
          center: hole.center,
          radius: hole.width / 2,
          fill: "#e2e8f0",
          stroke: "#475569",
        })),
      lines: traces.map((trace) => ({
        points: trace.route.filter((point) => point.route_type === "wire"),
        strokeWidth: srj.minTraceWidth,
        strokeColor: failingTraceIds.has(trace.pcb_trace_id)
          ? "#dc2626"
          : "#16a34a",
      })),
      texts: [
        ...gaps.map((gap) => ({
          x: 2.7,
          y: 0.66 + gap,
          text: `${gap.toFixed(1)} mm gap`,
          fontSize: 0.16,
          anchorSide: "center_left" as const,
        })),
        {
          x: 0.5,
          y: -0.85,
          text: "Red: below clearance / Green: clear",
          fontSize: 0.2,
        },
      ],
    })
  }
  expect({ srj, traces }).toEqual(before)
  const svg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(panels, {
      titles: ["0.0 mm clearance", "0.2 mm clearance", "0.5 mm clearance"],
    }),
    { backgroundColor: "white", svgWidth: 1400, svgHeight: 320 },
  )
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
