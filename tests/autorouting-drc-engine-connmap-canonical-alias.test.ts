import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { AutoroutingDrcEngine } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

const createPanel = ({
  title,
  padColor,
  errorCenters,
}: {
  title: string
  padColor: string
  errorCenters: Array<{ x: number; y: number }>
}): GraphicsObject => ({
  coordinateSystem: "cartesian",
  lines: [
    {
      points: [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ],
      strokeColor: "#2563eb",
      strokeWidth: 0.1,
      label: "root_net trace",
    },
  ],
  rects: [
    {
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      fill: padColor,
      stroke: padColor,
      label: title,
    },
    {
      center: { x: 0, y: 0 },
      width: 2.5,
      height: 1.5,
      fill: "rgba(255, 255, 255, 0)",
      stroke: "#475569",
      label: "board bounds",
    },
  ],
  circles: errorCenters.map((center) => ({
    center,
    radius: 0.18,
    fill: "rgba(220, 38, 38, 0.25)",
    stroke: "#dc2626",
    label: "DRC violation",
  })),
  points: [],
})

const createSrj = ({
  padConnectionName,
  pcbPortId,
}: {
  padConnectionName: string
  pcbPortId: string
}): SimpleRouteJson => ({
  bounds: { minX: -1.25, minY: -0.75, maxX: 1.25, maxY: 0.75 },
  connections: [
    {
      name: padConnectionName,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: pcbPortId },
        { x: 0, y: 0.5, layer: "top", pointId: `${pcbPortId}_other` },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: [`pcb_smtpad_${pcbPortId}`, pcbPortId],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
})

const trace: SimplifiedPcbTraces[number] = {
  type: "pcb_trace",
  pcb_trace_id: "trace_0",
  connection_name: "root_net",
  route: [
    { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
  ],
}

test("connMap net ids override point-pair canonical aliases", () => {
  const sameNetPortId = "pcb_port_same"
  const sameNetConnMap = new ConnectivityMap({})
  sameNetConnMap.addConnections([["root_net", sameNetPortId]])
  const sameNetResult = new AutoroutingDrcEngine(
    createSrj({
      padConnectionName: "same_net_split_pair",
      pcbPortId: sameNetPortId,
    }),
    { connMap: sameNetConnMap },
  ).evaluate([trace])

  const foreignResult = new AutoroutingDrcEngine(
    createSrj({
      padConnectionName: "foreign_split_pair",
      pcbPortId: "pcb_port_foreign",
    }),
    { connMap: sameNetConnMap },
  ).evaluate([trace])

  expect(sameNetResult.errors).toHaveLength(0)
  expect(foreignResult.errors).toHaveLength(1)
  expect(foreignResult.errors[0]?.pcb_trace_error_id).toBe(
    "overlap_trace_0_pcb_smtpad_pcb_port_foreign",
  )

  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        createPanel({
          title: "same-net pad",
          padColor: "rgba(22, 163, 74, 0.45)",
          errorCenters: sameNetResult.locationAwareErrors.map(
            (error) => error.center,
          ),
        }),
        createPanel({
          title: "foreign-net pad",
          padColor: "rgba(220, 38, 38, 0.35)",
          errorCenters: foreignResult.locationAwareErrors.map(
            (error) => error.center,
          ),
        }),
      ],
      {
        titles: ["SAME NET · NO DRC", "FOREIGN · DRC"],
      },
    ),
    { backgroundColor: "white", svgWidth: 900, svgHeight: 360 },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/autorouting-drc-engine-connmap-canonical-alias.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
