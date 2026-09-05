import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("HD conversion expands a four-layer via span using the actual stack", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const json = convertToCircuitJson(srj, [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
      ],
    },
  ])
  const via = json.find((element) => element.type === "pcb_via")
  expect(via?.layers).toEqual(["top", "inner1", "inner2"])
  const trace = json.find((element) => element.type === "pcb_trace")
  expect(trace?.route.at(-1)).toMatchObject({ layer: "inner2" })
})
