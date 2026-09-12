import { expect, test } from "bun:test"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkViaPadClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  AutoroutingDrcEngine,
  type AutoroutingDrcError,
} from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

type Point = { x: number; y: number }

const createTrace = (
  id: string,
  points: Point[],
  layer = "top",
  width = 0.1,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: id,
  route: points.map((point) => ({
    route_type: "wire",
    ...point,
    width,
    layer,
  })),
})

const createVia = (
  id: string,
  x: number,
  diameter = 0.3,
  holeDiameter = 0.15,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: id,
  route: [
    {
      route_type: "via",
      x,
      y: 0,
      from_layer: "top",
      to_layer: "inner1",
      via_diameter: diameter,
      via_hole_diameter: holeDiameter,
    },
  ],
})

const getErrorKey = (error: Record<string, unknown>): string => {
  const id =
    error.pcb_trace_error_id ??
    error.pcb_via_trace_clearance_error_id ??
    error.pcb_pad_trace_clearance_error_id ??
    error.pcb_pad_pad_clearance_error_id ??
    error.pcb_error_id
  return `${error.type}:${id}`
}

test("indexed DRC matches Core contact, clearance, drill and board-edge rules", () => {
  const pad: SimpleRouteJson["obstacles"][number] = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [],
    circuitJsonMetadata: { pcb_smtpad_id: "opaque_pad_id" },
  }
  const cases: Array<{
    name: string
    traces: SimplifiedPcbTrace[]
    obstacles?: SimpleRouteJson["obstacles"]
    rules?: Partial<SimpleRouteJson>
    expectedTypes: AutoroutingDrcError["type"][]
  }> = [
    {
      name: "explicit trace clearance and individual widths",
      traces: [
        createTrace(
          "a",
          [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
          ],
          "top",
          0.12,
        ),
        createTrace(
          "b",
          [
            { x: -1, y: 0.3 },
            { x: 1, y: 0.3 },
          ],
          "top",
          0.18,
        ),
      ],
      rules: { minTraceToPadEdgeClearance: 0.2 },
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "default trace clearance comes from checks, not a preferred margin",
      traces: [
        createTrace("a", [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ]),
        createTrace("b", [
          { x: -1, y: 0.25 },
          { x: 1, y: 0.25 },
        ]),
      ],
      expectedTypes: [],
    },
    {
      name: "positive pad clearance has its own type",
      traces: [
        createTrace("a", [
          { x: -1, y: 0.4 },
          { x: 1, y: 0.4 },
        ]),
      ],
      obstacles: [pad],
      rules: { minTraceToPadEdgeClearance: 0.2 },
      expectedTypes: ["pcb_pad_trace_clearance_error"],
    },
    {
      name: "the nearest declared port owns a pad, not every connectedTo alias",
      traces: [
        createTrace("a", [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ]),
      ],
      obstacles: [
        {
          ...pad,
          center: { x: 0.8, y: 0 },
          connectedTo: ["a", "b", "pcb_port_a", "pcb_port_b"],
        },
      ],
      rules: {
        connections: [
          {
            name: "a",
            pointsToConnect: [
              { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
            ],
          },
          {
            name: "b",
            pointsToConnect: [
              { x: 0.8, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
            ],
          },
        ],
      },
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "an unported pad with ambiguous declared nets does not belong to both",
      traces: [
        createTrace("a", [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ]),
      ],
      obstacles: [{ ...pad, connectedTo: ["a", "b"] }],
      rules: {
        connections: [
          { name: "a", pointsToConnect: [] },
          { name: "b", pointsToConnect: [] },
        ],
      },
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "pad contact suppresses every positive-clearance segment in the pair",
      traces: [
        createTrace("a", [
          { x: -1, y: 0.3 },
          { x: 1, y: 0.3 },
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ]),
      ],
      obstacles: [pad],
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "a zero-length wire inside a pad suppresses clearance without a contact error",
      traces: [
        createTrace("a", [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ]),
      ],
      obstacles: [pad],
      expectedTypes: [],
    },
    {
      name: "circular plated-pad clearance",
      traces: [
        createTrace("a", [
          { x: -1, y: 0.4 },
          { x: 1, y: 0.4 },
        ]),
      ],
      obstacles: [
        {
          ...pad,
          layers: ["top", "bottom"],
          circuitJsonMetadata: { pcb_plated_hole_id: "round_plated_pad" },
        },
      ],
      rules: { minTraceToPadEdgeClearance: 0.2 },
      expectedTypes: ["pcb_pad_trace_clearance_error"],
    },
    {
      name: "rotation metadata keeps a square plated pad rectangular",
      traces: [
        createTrace("a", [
          { x: -0.1, y: 0.21 },
          { x: 0.1, y: 0.21 },
        ]),
      ],
      obstacles: [
        {
          ...pad,
          ccwRotationDegrees: 0,
          layers: ["top", "bottom"],
          circuitJsonMetadata: { pcb_plated_hole_id: "rect_plated_pad" },
        },
      ],
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "rotated rectangular pad is not its axis-aligned bounding box",
      traces: [
        createTrace("a", [
          { x: -0.5, y: 0.55 },
          { x: -0.3, y: 0.55 },
        ]),
      ],
      obstacles: [{ ...pad, width: 1.2, height: 0.3, ccwRotationDegrees: 45 }],
      expectedTypes: [],
    },
    {
      name: "through-via positive clearance on a non-transition layer",
      traces: [
        createVia("via", 0),
        createTrace(
          "a",
          [
            { x: -1, y: 0.35 },
            { x: 1, y: 0.35 },
          ],
          "bottom",
        ),
      ],
      rules: { minTraceToPadEdgeClearance: 0.2 },
      expectedTypes: ["pcb_via_trace_clearance_error"],
    },
    {
      name: "via contact suppresses positive clearance for the whole pair",
      traces: [
        createVia("via", 0),
        createTrace("a", [
          { x: -1, y: 0.25 },
          { x: 1, y: 0.25 },
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ]),
      ],
      expectedTypes: ["pcb_trace_error"],
    },
    {
      name: "via spacing uses drill edges, not outer copper diameters",
      traces: [createVia("a", 0, 0.6, 0.2), createVia("b", 0.31, 0.6, 0.2)],
      expectedTypes: [],
    },
    {
      name: "drill fallback uses the declared board diameter, not each outer diameter",
      traces: [
        {
          ...createVia("a", 0, 0.6),
          route: [
            {
              route_type: "via",
              x: 0,
              y: 0,
              from_layer: "top",
              to_layer: "bottom",
              via_diameter: 0.6,
            },
          ],
        },
        {
          ...createVia("b", 0.31, 0.6),
          route: [
            {
              route_type: "via",
              x: 0.31,
              y: 0,
              from_layer: "top",
              to_layer: "bottom",
              via_diameter: 0.6,
            },
          ],
        },
      ],
      expectedTypes: [],
    },
    {
      name: "different-net drill clearance below the tolerance boundary",
      traces: [createVia("a", 0, 0.6, 0.2), createVia("b", 0.293, 0.6, 0.2)],
      expectedTypes: ["pcb_via_clearance_error"],
    },
    {
      name: "same-net vias still require drill spacing",
      traces: [createVia("a", 0, 0.6, 0.2), createVia("b", 0.293, 0.6, 0.2)],
      rules: {
        connections: [
          { name: "a", rootConnectionName: "same", pointsToConnect: [] },
          { name: "b", rootConnectionName: "same", pointsToConnect: [] },
        ],
      },
      expectedTypes: ["pcb_via_clearance_error"],
    },
    {
      name: "explicit zero drill clearance is not clamped",
      traces: [createVia("a", 0, 0.6, 0.2), createVia("b", 0.21, 0.6, 0.2)],
      rules: { minViaHoleEdgeToViaHoleEdgeClearance: 0 },
      expectedTypes: [],
    },
    {
      name: "via-pad clearance follows the pad-to-pad board rule",
      traces: [createVia("a", 0.5)],
      obstacles: [pad],
      rules: {
        minPadEdgeToPadEdgeClearance: 0.2,
        minViaEdgeToPadEdgeClearance: 0,
      },
      expectedTypes: ["pcb_pad_pad_clearance_error"],
    },
    {
      name: "board-edge errors are per wire pair, including differing layers",
      traces: [
        {
          ...createTrace("a", [
            { x: -1, y: 4.9 },
            { x: 0, y: 4.9 },
          ]),
          route: [
            { route_type: "wire", x: -1, y: 4.9, width: 0.1, layer: "top" },
            { route_type: "wire", x: 0, y: 4.9, width: 0.1, layer: "top" },
            { route_type: "wire", x: 1, y: 4.9, width: 0.1, layer: "bottom" },
          ],
        },
      ],
      expectedTypes: ["pcb_trace_error", "pcb_trace_error"],
    },
  ]

  for (const scenario of cases) {
    const srj: SimpleRouteJson = {
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      obstacles: scenario.obstacles ?? [],
      connections: scenario.traces.map((trace) => ({
        name: trace.connection_name,
        pointsToConnect: [],
      })),
      ...scenario.rules,
    }
    const circuitJson = convertToCircuitJson(srj, scenario.traces)
    const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
    connMap.addConnections(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via" && element.pcb_trace_id
          ? [[element.pcb_via_id, element.pcb_trace_id]]
          : [],
      ),
    )
    const referenceErrors = [
      ...checkEachPcbTraceNonOverlapping(circuitJson, { connMap }),
      ...checkPadTraceClearance(circuitJson, { connMap }),
      ...checkViaTraceClearance(circuitJson, { connMap }),
      ...checkViaPadClearance(circuitJson, { connMap }),
      ...checkSameNetViaSpacing(circuitJson, { connMap }),
      ...checkDifferentNetViaSpacing(circuitJson, { connMap }),
      ...checkPcbTracesOutOfBoard(circuitJson),
    ]
    const engineErrors = new AutoroutingDrcEngine(srj, {
      includeTraceViaOwnerMetadata: true,
    }).evaluate(scenario.traces).errors

    expect(
      engineErrors.map((error) => error.type).sort(),
      scenario.name,
    ).toEqual(scenario.expectedTypes.sort())
    expect(engineErrors.map(getErrorKey).sort(), scenario.name).toEqual(
      referenceErrors
        .map((error) =>
          getErrorKey(error as unknown as Record<string, unknown>),
        )
        .sort(),
    )
    for (const referenceError of referenceErrors) {
      const key = getErrorKey(
        referenceError as unknown as Record<string, unknown>,
      )
      const engineError = engineErrors.find(
        (error) => getErrorKey(error) === key,
      )!
      const center =
        "center" in referenceError
          ? referenceError.center
          : "pcb_center" in referenceError
            ? referenceError.pcb_center
            : undefined
      if (center) {
        if (center.x === undefined || center.y === undefined) {
          throw new Error(`Missing physical error center for ${scenario.name}`)
        }
        expect(engineError.center!.x, scenario.name).toBeCloseTo(center.x, 10)
        expect(engineError.center!.y, scenario.name).toBeCloseTo(center.y, 10)
      }
      if (!("actual_clearance" in referenceError)) continue
      expect(Number(engineError.actual_clearance), scenario.name).toBeCloseTo(
        Number(referenceError.actual_clearance),
        10,
      )
    }
  }
})
