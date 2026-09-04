import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

type Point = { x: number; y: number }

const createPanel = ({
  srj,
  points,
  via,
  before,
  clearance,
}: {
  srj: SimpleRouteJson
  points: Point[]
  via: boolean
  before: boolean
  clearance: number
}): GraphicsObject => {
  const pad = srj.obstacles[0]!
  return {
    coordinateSystem: "cartesian",
    rects: [
      {
        center: { x: 0, y: -0.05 },
        width: 3.4,
        height: 3.6,
        fill: "transparent",
        stroke: "transparent",
      },
      {
        center: pad.center,
        width: pad.width,
        height: pad.height,
        ccwRotationDegrees: pad.ccwRotationDegrees,
        fill: "rgba(234, 179, 8, 0.25)",
        stroke: "#a16207",
        label: "Actual rectangular copper (unchanged)",
      },
    ],
    lines: [
      ...(via
        ? []
        : [
            {
              points,
              strokeWidth: 0.1,
              strokeColor: "#2563eb",
              label: "Foreign-net trace: width 0.1 mm",
            },
          ]),
      ...(before && via
        ? [
            {
              points: [
                { x: -1, y: -0.5 },
                { x: 1, y: -0.5 },
                { x: 1, y: 0.5 },
                { x: -1, y: 0.5 },
                { x: -1, y: -0.5 },
              ],
              strokeWidth: 0.025,
              strokeColor: "#64748b",
              strokeDash: "5 4",
              label: "Old model ignored pad rotation",
            },
          ]
        : []),
    ],
    circles: [
      ...(before && !via
        ? [
            {
              center: pad.center,
              radius: pad.width / 2,
              fill: "transparent",
              stroke: "#64748b",
              label: "Old model inferred a circle",
            },
          ]
        : []),
      ...(via
        ? [
            {
              center: points[0]!,
              radius: 0.15,
              fill: "#2563eb",
              stroke: "#1d4ed8",
              label: "Foreign-net via: diameter 0.3 mm",
            },
            {
              center: points[0]!,
              radius: 0.065,
              fill: "white",
              stroke: "#1d4ed8",
            },
          ]
        : []),
      ...(!before
        ? [
            {
              center: via ? points[0]! : { x: 1.075, y: 1.075 },
              radius: via ? 0.25 : 0.16,
              fill: "transparent",
              stroke: "#dc2626",
              label: "Clearance violation detected",
            },
          ]
        : []),
    ],
    texts: [
      {
        x: 0,
        y: -1.5,
        text: before
          ? "Gray outline: incorrect old pad model"
          : `Gap ${clearance.toFixed(3)} mm vs 0.100 mm minimum`,
        fontSize: 0.1,
        anchorSide: "center",
        color: before ? "#475569" : "#b91c1c",
      },
      {
        x: 0,
        y: -1.68,
        text: "Gold: actual pad | Blue: foreign-net copper",
        fontSize: 0.09,
        anchorSide: "center",
        color: "#475569",
      },
    ],
  }
}

test("snapshots show pad violations missed by the old shape approximation", async (): Promise<void> => {
  for (const via of [false, true]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 2,
          height: via ? 1 : 2,
          ccwRotationDegrees: via ? 45 : 0,
          layers: ["top", "bottom"],
          connectedTo: ["pcb_plated_hole_pad"],
        },
      ],
    }
    const points = via
      ? [{ x: (1.14 - 0.64) / Math.SQRT2, y: (1.14 + 0.64) / Math.SQRT2 }]
      : [
          { x: 1.25, y: 0.9 },
          { x: 0.9, y: 1.25 },
        ]
    const traces: SimplifiedPcbTraces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "foreign-copper",
        connection_name: "foreign-net",
        route: via
          ? [
              { route_type: "wire", ...points[0]!, width: 0.1, layer: "top" },
              {
                route_type: "via",
                ...points[0]!,
                from_layer: "top",
                to_layer: "bottom",
              },
              {
                route_type: "wire",
                ...points[0]!,
                width: 0.1,
                layer: "bottom",
              },
            ]
          : points.map((point) => ({
              route_type: "wire" as const,
              ...point,
              width: 0.1,
              layer: "top",
            })),
      },
    ]
    // Explicit regression control: without rotation metadata, these inputs
    // reproduce the old circle / unrotated-rectangle approximations. Both
    // zero-error results were also verified on base commit c16f524.
    const legacySrj = structuredClone(srj)
    delete legacySrj.obstacles[0]!.ccwRotationDegrees
    const before = new AutoroutingDrcEngine(legacySrj).evaluate(traces)
    const after = new AutoroutingDrcEngine(srj).evaluate(traces)
    const clearance = via
      ? Math.hypot(0.14, 0.14) - 0.15
      : 0.15 / Math.SQRT2 - 0.05
    expect(before.errors).toHaveLength(0)
    expect(after.errors).toHaveLength(1)
    expect(after.errors[0]?.actual_clearance).toBeCloseTo(clearance, 6)

    const graphics = stackGraphicsHorizontally(
      [true, false].map((before) =>
        createPanel({ srj, points, via, before, clearance }),
      ),
      {
        titles: ["Before: violation missed", "After: violation detected"],
      },
    )
    const svg = getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1200,
      svgHeight: 620,
    })
      .replace(/[ \t]+$/gm, "")
      // The renderer reconstructs angles with atan2; its last bits differ
      // across JS runtimes. Canonicalize display angles, not DRC geometry.
      .replace(/rotate\(([-\d.e+]+)/g, (_, angle: string) =>
        `rotate(${Number(angle).toFixed(6)}`,
      )
    const name = via ? "rotated-pad-via" : "square-pad-corner"
    const snapshotPath = new URL(
      `./__snapshots__/${name}.snap.svg`,
      import.meta.url,
    ).pathname
    if (process.env.BUN_UPDATE_SNAPSHOTS) {
      writeFileSync(snapshotPath, svg)
      writeFileSync(
        snapshotPath.replace(/\.svg$/, ".png"),
        await getPngBufferFromGraphicsObject(graphics, {
          backgroundColor: "white",
          pngWidth: 1200,
          pngHeight: 620,
        }),
      )
    }
    expect(svg).toBe(readFileSync(snapshotPath, "utf8"))
  }
})
