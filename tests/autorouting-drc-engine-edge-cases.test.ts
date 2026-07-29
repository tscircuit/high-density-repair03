import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib"
import { getDrcErrors } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

const createSrj = (
  connectionNames: string[],
  overrides: Partial<SimpleRouteJson> = {},
): SimpleRouteJson => ({
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  connections: connectionNames.map((name) => ({
    name,
    pointsToConnect: [],
  })),
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.1,
  ...overrides,
})

const createWireTrace = ({
  traceId,
  connectionName,
  start,
  end,
  layer = "top",
  width = 0.1,
}: {
  traceId: string
  connectionName: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  layer?: string
  width?: number
}): SimplifiedPcbTraces[number] => ({
  type: "pcb_trace",
  pcb_trace_id: traceId,
  connection_name: connectionName,
  route: [
    { route_type: "wire", ...start, width, layer },
    { route_type: "wire", ...end, width, layer },
  ],
})

const getErrorKey = (error: Record<string, unknown>) =>
  String(error.pcb_trace_error_id ?? error.pcb_error_id)

test("does not report crossings on different copper layers", () => {
  const srj = createSrj(["net_a", "net_b"])
  const result = new AutoroutingDrcEngine(srj).evaluate([
    createWireTrace({
      traceId: "trace_a",
      connectionName: "net_a",
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
      layer: "top",
    }),
    createWireTrace({
      traceId: "trace_b",
      connectionName: "net_b",
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
      layer: "bottom",
    }),
  ])

  expect(result.errors).toHaveLength(0)
})

test("does not report same-net trace crossings or same-net pads", () => {
  const srj = createSrj(["net_a_mst0", "net_a_mst1"], {
    connections: [
      {
        name: "net_a_mst0",
        rootConnectionName: "net_a",
        pointsToConnect: [],
      },
      {
        name: "net_a_mst1",
        rootConnectionName: "net_a",
        pointsToConnect: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.5, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["pcb_smtpad_same_net", "net_a"],
      },
    ],
  })
  const result = new AutoroutingDrcEngine(srj).evaluate([
    createWireTrace({
      traceId: "trace_a",
      connectionName: "net_a_mst0",
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
    }),
    createWireTrace({
      traceId: "trace_b",
      connectionName: "net_a_mst1",
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
    }),
  ])

  expect(result.errors).toHaveLength(0)
})

test("applies the reference DRC tolerance at the clearance boundary", () => {
  const srj = createSrj(["net_a", "net_b"])
  const evaluateAtSeparation = (separation: number) =>
    new AutoroutingDrcEngine(srj).evaluate([
      createWireTrace({
        traceId: "trace_a",
        connectionName: "net_a",
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
      }),
      createWireTrace({
        traceId: "trace_b",
        connectionName: "net_b",
        start: { x: -1, y: separation },
        end: { x: 1, y: separation },
      }),
    ])

  expect(evaluateAtSeparation(0.19).errors).toHaveLength(1)
  expect(evaluateAtSeparation(0.196).errors).toHaveLength(0)
})

test("does not report two vias at the exact same location", () => {
  const srj = createSrj(["net_a", "net_b"])
  const traces: SimplifiedPcbTraces = ["net_a", "net_b"].map(
    (connectionName, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      connection_name: connectionName,
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        {
          route_type: "wire",
          x: 1,
          y: index,
          width: 0.1,
          layer: "bottom",
        },
      ],
    }),
  )

  const viaErrors = new AutoroutingDrcEngine(srj)
    .evaluate(traces)
    .errors.filter((error) => error.type === "pcb_via_clearance_error")

  expect(viaErrors).toHaveLength(0)
})

test("does not miss reference errors across randomized route geometry", () => {
  let randomState = 0x5eed1234
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    return randomState / 2 ** 32
  }
  const randomPoint = () => ({
    x: random() * 8 - 4,
    y: random() * 8 - 4,
  })

  for (let caseIndex = 0; caseIndex < 100; caseIndex += 1) {
    const connectionNames = Array.from(
      { length: 6 },
      (_, index) => `net_${index}`,
    )
    const srj = createSrj(connectionNames, {
      obstacles: Array.from({ length: 4 }, (_, index) => ({
        type: "rect" as const,
        layers: [index % 2 === 0 ? "top" : "bottom"],
        center: randomPoint(),
        width: 0.2 + random(),
        height: 0.2 + random(),
        connectedTo: [`pcb_smtpad_obstacle_${index}`],
      })),
    })
    const traces: SimplifiedPcbTraces = connectionNames.map(
      (connectionName, index) => {
        const start = randomPoint()
        const end = randomPoint()
        if (index % 2 === 0) {
          return createWireTrace({
            traceId: `trace_${index}`,
            connectionName,
            start,
            end,
            width: 0.08 + random() * 0.15,
          })
        }

        const via = randomPoint()
        return {
          type: "pcb_trace",
          pcb_trace_id: `trace_${index}`,
          connection_name: connectionName,
          route: [
            { route_type: "wire", ...start, width: 0.1, layer: "top" },
            { route_type: "wire", ...via, width: 0.1, layer: "top" },
            {
              route_type: "via",
              ...via,
              from_layer: "top",
              to_layer: "bottom",
              via_diameter: 0.25 + random() * 0.2,
            },
            { route_type: "wire", ...via, width: 0.1, layer: "bottom" },
            { route_type: "wire", ...end, width: 0.1, layer: "bottom" },
          ],
        }
      },
    )

    const optimizedErrorKeys = new Set(
      new AutoroutingDrcEngine(srj).evaluate(traces).errors.map(getErrorKey),
    )
    const referenceErrorKeys = getDrcErrors(
      convertToCircuitJson(srj, traces, 0.1, 0.3),
      { traceClearance: 0.1, viaClearance: 0.1 },
    ).errors.map((error) =>
      getErrorKey(error as unknown as Record<string, unknown>),
    )

    expect(
      referenceErrorKeys.filter(
        (errorKey) => !optimizedErrorKeys.has(errorKey),
      ),
    ).toEqual([])
  }
})
