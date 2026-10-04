import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { checkNativeDrcContinuity } from "../lib/drc/native/checkNativeDrcContinuity"
import { NativeDrcContactWorkspace } from "../lib/drc/native/NativeDrcContactWorkspace"
import { prepareNativeDrcPad } from "../lib/drc/native/nativeDrcGeometry"
import type {
  NativeDrcConnectivity,
  NativeDrcError,
  NativeDrcPad,
  NativeDrcPort,
  NativeDrcSourceTrace,
  NativeDrcTrace,
  NativeDrcVia,
  NativeDrcWire,
  PreparedNativeDrcEvaluation,
} from "../lib/drc/native/nativeDrcTypes"

type ReferenceCase = {
  name: string
  logicalNets: Array<[string, string | null]>
  expectedErrors: NativeDrcError[]
}

// Captured by an external audit against checks 0.0.233 and connectivity-map 0.0.19.
const reference = JSON.parse(
  readFileSync(
    new URL("./fixtures/native-drc-continuity-reference.json", import.meta.url),
    "utf8",
  ),
) as {
  format: string
  oracle: { package: string; version: string; sha256: string }
  connectivity: { package: string; version: string; sha256: string }
  cases: ReferenceCase[]
}

type Fixture = {
  name: string
  traces: NativeDrcTrace[]
  ports?: NativeDrcPort[]
  pads?: NativeDrcPad[]
  sources?: NativeDrcSourceTrace[]
  vias?: NativeDrcVia[]
  layerCount?: number
}

function wire(x: number, y: number, layer = "top", width = 0.1): NativeDrcWire {
  return { route_type: "wire", x, y, layer, width }
}

function trace(
  id: string,
  route: NativeDrcTrace["route"],
  source = "net",
): NativeDrcTrace {
  return { pcb_trace_id: id, source_trace_id: source, route }
}

function via(
  id: string,
  traceId: string,
  x: number,
  y: number,
  layers = ["top", "bottom"],
  diameter = 0.3,
): NativeDrcVia {
  return {
    kind: "via",
    id,
    traceId,
    x,
    y,
    layers,
    diameter,
    holeDiameter: 0.15,
    bounds: {
      minX: x - diameter / 2,
      minY: y - diameter / 2,
      maxX: x + diameter / 2,
      maxY: y + diameter / 2,
    },
  }
}

function pad(
  id: string,
  portId: string,
  x: number,
  layer = "top",
): NativeDrcPad {
  return {
    id,
    portId,
    x,
    y: 0,
    kind: "smtpad",
    shape: "rect",
    width: 0.3,
    height: 0.3,
    layers: [layer],
  }
}

function adjacentFloat(value: number, direction: -1 | 1): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction))
  return view.getFloat64(0)
}

function prepareFixture(
  fixture: Fixture,
  expected: ReferenceCase,
): PreparedNativeDrcEvaluation {
  const ports = fixture.ports ?? []
  const pads = fixture.pads ?? []
  const sources = fixture.sources ?? [{ id: "net", portIds: [] }]
  const vias = fixture.vias ?? []
  const logicalNets = new Map(
    expected.logicalNets.map(([id, net]) => [id, net ?? undefined] as const),
  )
  const connectivity: NativeDrcConnectivity = {
    getNetConnectedToId: (id) => logicalNets.get(id),
    areIdsConnected: (left, right) => {
      if (left === right) return true
      const leftNet = logicalNets.get(left)
      const rightNet = logicalNets.get(right)
      return Boolean(
        leftNet && rightNet && (leftNet === rightNet || rightNet === left),
      )
    },
  }
  return {
    traces: fixture.traces,
    pads: pads.map(prepareNativeDrcPad),
    vias,
    overlapSegments: [],
    clearanceSegments: [],
    contacts: new NativeDrcContactWorkspace(),
    scene: {
      pads,
      holes: [],
      ports,
      sourceTraces: sources,
      connectivity,
      createConnectivity: () => ({
        logical: connectivity,
        clearance: connectivity,
      }),
      layerCount: fixture.layerCount ?? 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      allowBlindAndBuriedVias: false,
      traceClearance: 0.1,
      viaHoleClearance: 0.1,
      holeClearance: 0.1,
    },
    areConnected: (left, right) => connectivity.areIdsConnected(left, right),
  }
}

test("native physical continuity matches saved reference errors across ports, branches, layers, vias, and orphan endpoints", () => {
  const ports: NativeDrcPort[] = [
    { id: "port_a", x: -1, y: 0, layers: ["top"] },
    { id: "port_b", x: 1, y: 0, layers: ["top"] },
  ]
  const pads = [pad("pad_a", "port_a", -1), pad("pad_b", "port_b", 1)]
  const sources = [{ id: "net", portIds: ["port_a", "port_b"] }]
  const fixtures: Fixture[] = [
    {
      name: "complete direct connection",
      traces: [trace("t", [wire(-1, 0), wire(1, 0)])],
      ports,
      pads,
      sources,
    },
    {
      name: "missing expected port",
      traces: [trace("t", [wire(-1, 0), wire(0.5, 0)])],
      ports,
      pads,
      sources,
    },
    {
      name: "connected multi-trace source",
      traces: [
        trace("t_a", [wire(-1, 0), wire(0, 0)]),
        trace("t_b", [wire(0, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
    },
    {
      name: "broken multi-trace source",
      traces: [
        trace("t_a", [wire(-1, 0), wire(-0.2, 0)]),
        trace("t_b", [wire(0.2, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
    },
    {
      name: "two disconnected orphan endpoints",
      traces: [trace("t", [wire(-1, 0), wire(1, 0)])],
    },
    {
      name: "coincident orphan endpoint emits once",
      traces: [trace("t", [wire(0, 0), wire(0, 0)])],
    },
    {
      name: "same-net copper endpoint contact",
      traces: [
        trace("t_a", [wire(-1, 0), wire(1, 0)]),
        trace("t_b", [wire(1, 0), wire(-1, 0)]),
      ],
    },
    {
      name: "different-net contact does not cure orphan endpoints",
      traces: [
        trace("t_a", [wire(-1, 0), wire(1, 0)], "a"),
        trace("t_b", [wire(1, 0), wire(-1, 0)], "b"),
      ],
      sources: [
        { id: "a", portIds: [] },
        { id: "b", portIds: [] },
      ],
    },
    {
      name: "empty route remains ignored",
      traces: [trace("t", [])],
      ports,
      pads,
      sources,
    },
    {
      name: "padless declared port remains ignored",
      traces: [trace("t", [wire(-1, 0), wire(1, 0)])],
      ports,
      pads: [],
      sources,
    },
    {
      name: "wrong terminal layer",
      traces: [
        trace("t", [
          { ...wire(-1, 0, "bottom"), start_pcb_port_id: "port_a" },
          { ...wire(1, 0, "bottom"), end_pcb_port_id: "port_b" },
        ]),
      ],
      ports,
      pads,
      sources,
    },
    {
      name: "fullspan physical via bridges terminal layer",
      traces: [
        trace("t", [
          { ...wire(-1, 0, "bottom"), start_pcb_port_id: "port_a" },
          { ...wire(1, 0, "bottom"), end_pcb_port_id: "port_b" },
        ]),
      ],
      ports,
      pads,
      sources,
      vias: [via("v_a", "t", -1, 0), via("v_b", "t", 1, 0)],
    },
    {
      name: "different-layer branches joined by physical via",
      traces: [
        trace("t_a", [wire(-1, 0), wire(0, 0)]),
        trace("t_b", [wire(0, 0, "bottom"), wire(1, 0, "bottom")]),
      ],
      ports: [ports[0]!, { ...ports[1]!, layers: ["bottom"] }],
      pads: [pads[0]!, { ...pads[1]!, layers: ["bottom"] }],
      sources,
      vias: [via("v", "t_a", 0, 0)],
    },
    {
      name: "same logical net without physical contact remains disconnected",
      traces: [
        trace("t_a", [wire(-1, 0), wire(-0.4, 0)]),
        trace("t_b", [wire(0.4, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
    },
    {
      name: "first route chooses source error and center",
      traces: [
        trace("t_a", [wire(-0.6, 0), wire(-0.4, 0)]),
        trace("t_b", [wire(0.4, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
    },
    {
      name: "internal via continues to be checked on later source route",
      traces: [
        trace("t_a", [wire(-1, 0), wire(1, 0)]),
        trace("t_b", [
          wire(0, 0),
          {
            route_type: "via",
            x: 0.1,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          wire(0, 0, "bottom"),
        ]),
      ],
      ports,
      pads,
      sources,
      vias: [via("v", "t_b", 0.1, 0)],
    },
  ]
  for (const delta of [0, 0.009999, 0.01, 0.010001]) {
    fixtures.push({
      name: `strict internal via alignment ${delta}`,
      traces: [
        trace("t", [
          wire(-1, 0),
          wire(delta, 0),
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          wire(delta, 0, "bottom"),
          wire(1, 0, "bottom"),
        ]),
      ],
      ports: [ports[0]!, { ...ports[1]!, layers: ["bottom"] }],
      pads: [pads[0]!, { ...pads[1]!, layers: ["bottom"] }],
      sources,
      vias: [via("v", "t", 0, 0)],
    })
  }
  for (const gap of [0, 0.099999999, 0.1, 0.100000001, 0.3]) {
    fixtures.push({
      name: `native trace-contact gap ${gap}`,
      traces: [
        trace("t_a", [wire(-1, 0), wire(0, 0)]),
        trace("t_b", [wire(gap, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
    })
  }
  for (const rotation of [0, 30, 90, 135]) {
    fixtures.push({
      name: `rotated terminal pad ${rotation}`,
      traces: [trace("t", [wire(-1, 0), wire(0.5, 0)])],
      ports,
      pads: [
        { ...pads[0]!, rotation },
        { ...pads[1]!, rotation },
      ],
      sources,
    })
  }
  for (const kind of ["smtpad", "plated_hole"] as const) {
    fixtures.push({
      name: `${kind} polygon edge cross-product tolerance`,
      traces: [trace("t", [wire(-1, 0), wire(0.050000005, 0)])],
      ports: [{ id: "edge", x: 0, y: 0, layers: ["top"] }],
      pads: [
        {
          id: "edge_pad",
          portId: "edge",
          kind,
          shape: "rect",
          x: 0,
          y: 0,
          width: 0.1,
          height: 0.1,
          rotation: 0,
          layers: ["top"],
        },
      ],
      sources: [{ id: "net", portIds: ["edge"] }],
    })
  }
  for (const logicallyDeclared of [false, true]) {
    fixtures.push({
      name: `foreign physical via has separate logical membership ${logicallyDeclared}`,
      traces: [
        trace("t_a", [wire(-1, 0), wire(0, 0)]),
        trace("t_b", [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          wire(0, 0, "bottom"),
          wire(1, 0, "bottom"),
        ]),
      ],
      pads: [pads[0]!, { ...pads[1]!, layers: ["bottom"] }],
      sources: [{ id: "net", portIds: logicallyDeclared ? ["v"] : [] }],
      vias: [via("v", "t_b", 0, 0)],
    })
  }
  for (const separation of [0.3, 0.30000005, 0.3000002]) {
    fixtures.push({
      name: `physical via graph contact tolerance ${separation}`,
      traces: [
        trace("t_a", [wire(-1, 0), wire(0, 0)]),
        trace("t_b", [wire(separation, 0), wire(1, 0)]),
      ],
      ports,
      pads,
      sources,
      vias: [via("v_a", "t_a", 0, 0), via("v_b", "t_b", separation, 0)],
    })
  }
  for (const [originX, originY] of [
    [0, 0],
    [123.456, -78.901],
  ] as const) {
    for (const direction of [-1, 0, 1] as const) {
      const offset =
        direction === 0 ? 0.2 + 1e-7 : adjacentFloat(0.2 + 1e-7, direction)
      const centerX = originX - 0.8 * offset
      const centerY = originY + 0.6 * offset
      const terminalX = centerX + 0.3
      const terminalY = centerY + 0.4
      fixtures.push({
        name: `angled via-wire scaled contact ULP ${direction} origin ${originX},${originY}`,
        traces: [
          trace("t_a", [
            wire(originX - 1, originY),
            wire(originX, originY),
            {
              route_type: "via",
              x: originX,
              y: originY,
              from_layer: "top",
              to_layer: "bottom",
            },
            wire(originX, originY, "bottom"),
          ]),
          trace("t_b", [
            wire(centerX - 0.3, centerY - 0.4, "bottom"),
            wire(terminalX, terminalY, "bottom"),
          ]),
        ],
        ports: [
          { id: "port_a", x: originX - 1, y: originY, layers: ["top"] },
          { id: "port_b", x: terminalX, y: terminalY, layers: ["bottom"] },
        ],
        pads: [
          { ...pads[0]!, x: originX - 1, y: originY },
          { ...pads[1]!, x: terminalX, y: terminalY, layers: ["bottom"] },
        ],
        sources,
        vias: [via("v", "t_a", originX, originY)],
      })
      const separation =
        direction === 0 ? 0.3 + 1e-7 : adjacentFloat(0.3 + 1e-7, direction)
      const viaBX = originX + 0.6 * separation
      const viaBY = originY + 0.8 * separation
      fixtures.push({
        name: `angled via-via scaled contact ULP ${direction} origin ${originX},${originY}`,
        traces: [
          trace("t_a", [
            wire(originX - 1, originY),
            wire(originX, originY),
            {
              route_type: "via",
              x: originX,
              y: originY,
              from_layer: "top",
              to_layer: "bottom",
            },
            wire(originX, originY, "bottom"),
          ]),
          trace("t_b", [
            {
              route_type: "via",
              x: viaBX,
              y: viaBY,
              from_layer: "top",
              to_layer: "bottom",
            },
            wire(viaBX, viaBY, "bottom"),
            wire(originX + 1, originY + 1, "bottom"),
          ]),
        ],
        ports: [
          { id: "port_a", x: originX - 1, y: originY, layers: ["top"] },
          { id: "port_b", x: originX + 1, y: originY + 1, layers: ["bottom"] },
        ],
        pads: [
          { ...pads[0]!, x: originX - 1, y: originY },
          { ...pads[1]!, x: originX + 1, y: originY + 1, layers: ["bottom"] },
        ],
        sources,
        vias: [
          via("v_a", "t_a", originX, originY),
          via("v_b", "t_b", viaBX, viaBY),
        ],
      })
    }
  }
  fixtures.push({
    name: "physical via graph retains a nonzero 1e-10 conductor",
    traces: [
      trace("t_a", [
        wire(-1, 0),
        wire(0, 0),
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        wire(0, 0, "bottom"),
      ]),
      trace("t_b", [wire(0.199, 0, "bottom"), wire(0.199, 1e-10, "bottom")]),
    ],
    ports: [
      ports[0]!,
      { id: "port_b", x: 0.199, y: 1e-10, layers: ["bottom"] },
    ],
    pads: [
      pads[0]!,
      {
        ...pads[1]!,
        x: 0.199,
        y: 1e-10,
        width: 0.01,
        height: 0.01,
        layers: ["bottom"],
      },
    ],
    sources,
    vias: [via("v", "t_a", 0, 0)],
  })
  fixtures.push({
    name: "duplicate trace id names first routes while physical topology uses last",
    traces: [
      trace(
        "duplicate",
        [
          { ...wire(-1, 0), start_pcb_port_id: "port_a" },
          { ...wire(1, 0), end_pcb_port_id: "port_b" },
        ],
        "source_a",
      ),
      trace(
        "duplicate",
        [
          { ...wire(-1, 1, "bottom"), start_pcb_port_id: "port_c" },
          {
            route_type: "via",
            x: 0,
            y: 1,
            from_layer: "top",
            to_layer: "bottom",
          },
          { ...wire(1, 1, "bottom"), end_pcb_port_id: "port_d" },
        ],
        "source_b",
      ),
    ],
    ports: [
      ...ports,
      { id: "port_c", x: -1, y: 1, layers: ["top"] },
      { id: "port_d", x: 1, y: 1, layers: ["top"] },
    ],
    pads: [
      ...pads,
      { ...pads[0]!, id: "pad_c", portId: "port_c", y: 1 },
      { ...pads[1]!, id: "pad_d", portId: "port_d", y: 1 },
    ],
    sources: [
      { id: "source_a", portIds: ["port_a", "port_b"] },
      { id: "source_b", portIds: ["port_c", "port_d"] },
    ],
    vias: [via("v", "duplicate", 0, 1)],
  })
  fixtures.push({
    name: "SDK19 inner wire-pair layer semantics remain unchanged",
    layerCount: 4,
    traces: [
      trace("t_a", [
        wire(-1, -1),
        wire(1, -1),
        wire(1, 1),
        {
          route_type: "via",
          x: 1,
          y: 1,
          from_layer: "top",
          to_layer: "bottom",
        },
        wire(-1, 0, "bottom"),
        wire(1, 0, "bottom"),
      ]),
      trace("t_b", [
        wire(0, 0),
        wire(0.1, 0),
        {
          route_type: "via",
          x: 0.1,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
        wire(0, -1, "inner1"),
        wire(0, 1, "inner1"),
      ]),
    ],
    ports: [
      { id: "port_a", x: -1, y: -1, layers: ["top"] },
      { id: "port_b", x: 0, y: 1, layers: ["inner1"] },
    ],
    pads: [
      { ...pads[0]!, y: -1 },
      { ...pads[1]!, x: 0, y: 1, layers: ["inner1"] },
    ],
    sources,
  })
  expect({
    format: reference.format,
    oracle: reference.oracle,
    connectivity: reference.connectivity,
    caseNames: reference.cases.map((entry) => entry.name),
  }).toEqual({
    format: "native-drc-continuity-reference-v3",
    oracle: {
      package: "@tscircuit/checks",
      version: "0.0.233",
      sha256:
        "7b2a2f58ceaad44bf7151016934d5760a3fdc092f8e6989f9824ecbfcca314cd",
    },
    connectivity: {
      package: "circuit-json-to-connectivity-map",
      version: "0.0.19",
      sha256:
        "ef18082e9a93c3bc3f6eda1f28a64f1a239d1090be7cfe9a67209d130634b585",
    },
    caseNames: fixtures.map((fixture) => fixture.name),
  })
  for (const fixture of fixtures) {
    const expected = reference.cases.find(
      (entry) => entry.name === fixture.name,
    )!
    expect(
      checkNativeDrcContinuity(prepareFixture(fixture, expected)) as unknown,
      fixture.name,
    ).toEqual(expected.expectedErrors)
  }
})
