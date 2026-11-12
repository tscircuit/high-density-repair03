import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { AutoroutingDrcEngine } from "../lib"
import { getViaDrillLayers } from "../lib/utils/getViaLayers"
import { createDisjointBlindVias } from "./fixtures/disjointBlindVias"

test("snapshots actual DRC results beside the blind-via copper layers", async (): Promise<void> => {
  const { srj, traces } = createDisjointBlindVias()
  const result = new AutoroutingDrcEngine(srj).evaluate(traces)
  const layers = ["top", "inner1", "inner2", "bottom"]
  const projection: GraphicsObject = {
    coordinateSystem: "cartesian",
    circles: [],
    points: result.errors.map((error) => ({
      ...error.center!,
      color: "#dc2626",
      label: "Reported via-pair DRC",
    })),
    texts: [
      {
        x: 0.1,
        y: 0.42,
        text: `Via-pair DRC count: ${result.errors.length}`,
        fontSize: 0.06,
        anchorSide: "center",
      },
      {
        x: 0.1,
        y: -0.38,
        text: "0.30 mm vias / 0.20 mm XY spacing",
        fontSize: 0.05,
        anchorSide: "center",
      },
    ],
  }
  const stack: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: [],
    lines: layers.map((layer, z) => ({
      points: [
        { x: -0.35, y: -z * 0.2 },
        { x: 0.55, y: -z * 0.2 },
      ],
      strokeColor: "#cbd5e1",
      strokeWidth: 0.006,
    })),
    texts: [
      ...layers.map((layer, z) => ({
        x: -0.49,
        y: -z * 0.2,
        text: layer,
        fontSize: 0.05,
        anchorSide: "center" as const,
      })),
      {
        x: 0.1,
        y: 0.23,
        text: "No shared copper layer",
        fontSize: 0.06,
        anchorSide: "center",
      },
      {
        x: 0.1,
        y: -0.83,
        text: "Layer spacing shown schematically",
        fontSize: 0.045,
        anchorSide: "center",
      },
    ],
  }
  for (const [index, trace] of traces.entries()) {
    const via = trace.route[0]!
    if (via.route_type !== "via") throw new Error("Expected a via fixture")
    const color = index === 0 ? "#2563eb" : "#9333ea"
    const width = via.via_diameter!
    projection.circles!.push({
      center: via,
      radius: width / 2,
      fill: `${color}88`,
      stroke: color,
      label: trace.connection_name,
    })
    projection.texts!.push({
      x: via.x + (index === 0 ? -0.2 : 0.2),
      y: 0.23,
      text: trace.connection_name,
      fontSize: 0.05,
      anchorSide: "center",
    })
    const copperLayers = getViaDrillLayers({
      via,
      layerCount: srj.layerCount,
      allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
    })
    const positions = copperLayers.map((layer) => -layers.indexOf(layer) * 0.2)
    stack.lines!.push({
      points: positions.map((y) => ({ x: via.x, y })),
      strokeColor: color,
      strokeWidth: 0.018,
    })
    for (const y of positions)
      stack.rects!.push({
        center: { x: via.x, y },
        width,
        height: 0.035,
        fill: color,
        label: trace.connection_name,
      })
  }
  const graphics = stackGraphicsHorizontally([projection, stack], {
    titles: ["XY projection", "Physical copper spans"],
  })
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1100,
      svgHeight: 550,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
