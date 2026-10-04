import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import type { AnyCircuitElement } from "circuit-json"
import { PreparedNativeDrcScene } from "../lib/drc/PreparedNativeDrcScene"
import type {
  NativeDrcSceneInput,
  NativeDrcSourceTrace,
  NativeDrcTrace,
} from "../lib/drc/native/nativeDrcTypes"

type RecordElement = Record<string, unknown>

const oracle = JSON.parse(
  gunzipSync(
    new Uint8Array(
      readFileSync(
        new URL(
          "./fixtures/native-drc-reference-expected.json.gz",
          import.meta.url,
        ),
      ),
    ),
  ).toString("utf8"),
) as {
  checksVersion: string
  checksSha256: string
  results: unknown[][]
}

function fixedElements(
  input: NativeDrcSceneInput,
  sources: NativeDrcSourceTrace[] = input.sourceTraces,
): RecordElement[] {
  const elements: RecordElement[] = sources.map((source) => ({
    type: "source_trace",
    source_trace_id: source.id,
    connected_source_port_ids: source.portIds,
    connected_source_net_ids: source.netIds ?? [],
  }))
  for (const port of input.ports)
    elements.push({
      type: "pcb_port",
      pcb_port_id: port.id,
      source_port_id: port.id,
      x: port.x,
      y: port.y,
      layers: port.layers,
      ...(port.componentId ? { pcb_component_id: port.componentId } : {}),
    })
  for (const pad of input.pads) {
    const plated = pad.kind === "plated_hole"
    const element: RecordElement = {
      type: plated ? "pcb_plated_hole" : "pcb_smtpad",
      [plated ? "pcb_plated_hole_id" : "pcb_smtpad_id"]: pad.id,
      x: pad.x,
      y: pad.y,
      ...(plated ? { layers: pad.layers } : { layer: pad.layers[0] }),
      ...(pad.portId ? { pcb_port_id: pad.portId } : {}),
      ...(pad.componentId ? { pcb_component_id: pad.componentId } : {}),
    }
    if (pad.shape === "circle")
      Object.assign(
        element,
        plated
          ? {
              shape: "circle",
              outer_diameter: pad.radius! * 2,
              hole_diameter: pad.radius!,
            }
          : { shape: "circle", radius: pad.radius },
      )
    else if (plated)
      Object.assign(element, {
        shape: "circular_hole_with_rect_pad",
        rect_pad_width: pad.width,
        rect_pad_height: pad.height,
        hole_diameter: Math.min(pad.width, pad.height) / 2,
        ...(pad.rotation !== undefined
          ? { rect_ccw_rotation: pad.rotation }
          : {}),
      })
    else
      Object.assign(element, {
        shape: pad.rotation === undefined ? "rect" : "rotated_rect",
        width: pad.width,
        height: pad.height,
        ...(pad.rotation !== undefined ? { ccw_rotation: pad.rotation } : {}),
      })
    elements.push(element)
  }
  for (const hole of input.holes)
    elements.push({
      type: "pcb_hole",
      pcb_hole_id: hole.id,
      x: hole.x,
      y: hole.y,
      hole_shape: hole.shape,
      ...(hole.shape === "circle"
        ? { hole_diameter: hole.diameter }
        : { hole_width: hole.width, hole_height: hole.height }),
      ...(hole.componentId ? { pcb_component_id: hole.componentId } : {}),
    })
  if (input.board)
    elements.push({
      type: "pcb_board",
      pcb_board_id: input.board.id ?? "board",
      num_layers: input.layerCount,
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      outline: input.board.outline,
      min_board_edge_clearance: input.board.edgeClearance,
      min_pad_edge_to_pad_edge_clearance: input.board.padClearance,
    })
  if (input.fixedIdentityOrder) {
    const fixed = elements.filter(
      (element) =>
        element.type !== "source_trace" && element.type !== "pcb_board",
    )
    const typeByKind = {
      port: "pcb_port",
      smtpad: "pcb_smtpad",
      plated_hole: "pcb_plated_hole",
      hole: "pcb_hole",
    }
    return [
      ...elements.filter((element) => element.type === "source_trace"),
      ...input.fixedIdentityOrder.map((identity) => {
        const type = typeByKind[identity.kind]
        const element = fixed.find(
          (record) =>
            record.type === type && record[`${type}_id`] === identity.id,
        )
        if (!element) throw new Error("Missing fixture identity")
        return element
      }),
      ...elements.filter((element) => element.type === "pcb_board"),
    ]
  }
  return elements
}

function createInput(seed: number): {
  input: NativeDrcSceneInput
  traces: NativeDrcTrace[]
} {
  let state = seed + 1
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const input: NativeDrcSceneInput = {
    pads: [],
    holes: [],
    ports: [],
    sourceTraces: [
      { id: "source_a", portIds: [] },
      { id: "source_b", portIds: [] },
      { id: "source_c", portIds: [] },
    ],
    connectivity: getFullConnectivityMapFromCircuitJson([]),
    createConnectivity: () => {
      throw new Error("Factory not initialized")
    },
    layerCount: 4,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    allowBlindAndBuriedVias: seed % 2 === 0,
    traceClearance: 0.1,
    viaHoleClearance: 0.1,
    holeClearance: 0.15,
    board: {
      id: "board",
      outline: [
        { x: -1.5, y: -1.5 },
        { x: 1.5, y: -1.5 },
        { x: 1.5, y: 1.5 },
        { x: -1.5, y: 1.5 },
      ],
      edgeClearance: 0.02,
      padClearance: 0.12,
    },
  }
  for (let i = 0; i < 4; i++) {
    const x = (random() - 0.5) * 2
    const y = (random() - 0.5) * 2
    const portId = `port_${i}`
    input.ports.push({ id: portId, x, y, layers: [i % 2 ? "bottom" : "top"] })
    input.sourceTraces[i % 3]!.portIds.push(portId)
    const circle = i === 1
    input.pads.push({
      id: `pad_${i}`,
      kind: i < 2 ? "smtpad" : "plated_hole",
      shape: circle ? "circle" : "rect",
      width: 0.25,
      height: 0.17,
      ...(circle ? { radius: 0.125 } : i === 2 ? { rotation: 33 } : {}),
      x,
      y,
      layers:
        i < 2
          ? [i % 2 ? "bottom" : "top"]
          : ["top", "inner1", "inner2", "bottom"],
      portId,
    })
  }
  input.holes.push(
    {
      id: "hole_circle",
      x: random() - 0.5,
      y: random() - 0.5,
      shape: "circle",
      diameter: 0.2,
    },
    {
      id: "hole_rect",
      x: random() - 0.5,
      y: random() - 0.5,
      shape: "rect",
      width: 0.3,
      height: 0.2,
    },
  )
  input.createConnectivity = (sources, traceLinks, viaOwnerLinks) => {
    const logical = getFullConnectivityMapFromCircuitJson([
      ...fixedElements(input, sources),
      ...traceLinks.map(([pcb_trace_id, source_trace_id]) => ({
        type: "pcb_trace",
        pcb_trace_id,
        source_trace_id,
        route: [],
      })),
    ] as unknown as AnyCircuitElement[])
    const clearance = new ConnectivityMap(
      Object.fromEntries(
        Object.entries(logical.netMap).map(([net, ids]) => [net, [...ids]]),
      ),
    )
    clearance.addConnections(viaOwnerLinks)
    return { logical, clearance }
  }
  input.connectivity = input.createConnectivity(
    input.sourceTraces,
    [],
    [],
  ).logical
  const traces: NativeDrcTrace[] = []
  for (let i = 0; i < 6; i++) {
    const x = (random() - 0.5) * 3
    const y = (random() - 0.5) * 3
    const layer = i % 2 ? "bottom" : "top"
    const firstWidth = 0.08 + random() * 0.15
    const lastWidth = 0.08 + random() * 0.15
    const via = {
      route_type: "via" as const,
      x,
      y,
      from_layer: layer,
      to_layer: "inner1",
      via_diameter: 0.25 + random() * 0.15,
      via_hole_diameter: 0.1 + random() * 0.1,
    }
    traces.push({
      pcb_trace_id: `trace_${i}`,
      source_trace_id:
        i === 4 && seed % 4 === 0 ? "" : `source_${["a", "b", "c"][i % 3]}`,
      route:
        i % 3 === 0 || i === 5
          ? [
              { route_type: "wire", x: x - 0.6, y, width: firstWidth, layer },
              { route_type: "wire", x, y, width: lastWidth, layer },
              via,
              { route_type: "wire", x, y, width: firstWidth, layer: "inner1" },
              {
                route_type: "wire",
                x: x + 0.4,
                y: y + 0.2,
                width: lastWidth,
                layer: "inner1",
              },
            ]
          : [
              { route_type: "wire", x, y, width: firstWidth, layer },
              {
                route_type: "wire",
                x: x + 0.7,
                y: y + random() - 0.5,
                width: lastWidth,
                layer,
              },
            ],
    })
  }
  if (seed >= 128) {
    // Converter-supported duplicate IDs retain every copper record. Different
    // sources, ports and routes also exercise first-name/last-physical lookup.
    const first = traces[0]!.route[0]!
    if (first.route_type === "wire") first.start_pcb_port_id = "port_0"
    const duplicate: NativeDrcTrace = {
      pcb_trace_id: traces[0]!.pcb_trace_id,
      source_trace_id: "source_b",
      route: traces[1]!.route.map((point) => ({ ...point })),
    }
    const last = duplicate.route[duplicate.route.length - 1]!
    if (last.route_type === "wire") last.end_pcb_port_id = "port_1"
    traces.push(duplicate)
    // A coincident duplicate via has the first emitted via's owner identity.
    if (seed % 2 === 0)
      traces.push({
        ...traces[0]!,
        source_trace_id: "source_c",
        route: traces[0]!.route.map((point) => ({ ...point })),
      })
    input.pads[2]!.id = input.pads[0]!.id
    switch (seed % 4) {
      case 0:
        traces[2]!.pcb_trace_id = "via_0"
        break
      case 1:
        input.pads[0]!.id = "via_0"
        input.pads[2]!.id = "via_0"
        break
      case 2:
        input.sourceTraces[0]!.id = "via_0"
        for (const trace of traces)
          if (trace.source_trace_id === "source_a")
            trace.source_trace_id = "via_0"
        break
      case 3:
        input.holes[0]!.id = input.pads[0]!.id
        traces[2]!.pcb_trace_id = input.pads[0]!.id
        break
    }
  }
  if (seed >= 160) {
    input.ports = []
    input.holes = []
    input.sourceTraces = [
      { id: "source_a", portIds: [] },
      { id: "source_b", portIds: [] },
    ]
    input.pads = [
      {
        id: "duplicate_pad",
        kind: "smtpad",
        shape: "rect",
        width: 0.1,
        height: 0.1,
        x: 0,
        y: -0.16,
        layers: [seed % 2 ? "bottom" : "top"],
      },
      {
        id: "duplicate_pad",
        kind: "plated_hole",
        shape: "circle",
        width: 0.2,
        height: 0.2,
        radius: 0.1,
        x: 0,
        y: 0,
        layers: ["top", "inner1", "inner2", "bottom"],
      },
    ]
    if (seed % 4 >= 2)
      input.fixedIdentityOrder = [
        { id: "duplicate_pad", kind: "plated_hole" },
        { id: "duplicate_pad", kind: "smtpad" },
      ]
    traces.splice(0, traces.length, {
      pcb_trace_id: "crossing",
      source_trace_id: "source_a",
      route: [
        {
          route_type: "wire",
          x: -0.5,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "first_port",
        },
        { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
      ],
    })
    if (seed % 4 === 3)
      traces.push({
        pcb_trace_id: "crossing",
        source_trace_id: "source_b",
        route: [
          { route_type: "wire", x: 0.4, y: 0, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0.4,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          {
            route_type: "wire",
            x: 0.4,
            y: 0,
            width: 0.1,
            layer: "bottom",
            end_pcb_port_id: "last_port",
          },
        ],
      })
  }
  if (seed >= 168) {
    input.layerCount = 11
    input.pads[1]!.layers = [
      "top",
      "inner1",
      "inner2",
      "inner3",
      "inner4",
      "inner5",
      "inner6",
      "inner7",
      "inner8",
      "inner9",
      "bottom",
    ]
    traces.push({
      pcb_trace_id: "eleven_layer",
      source_trace_id: "source_b",
      route: [
        { route_type: "wire", x: 0.25, y: -0.4, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.25,
          y: -0.4,
          from_layer: "top",
          to_layer: "inner9",
        },
        { route_type: "wire", x: 0.25, y: -0.4, width: 0.1, layer: "inner9" },
        { route_type: "wire", x: 0.5, y: -0.4, width: 0.1, layer: "inner9" },
      ],
    })
  }
  return { input, traces }
}

test("prepared native validation preserves independently recorded reference errors and centers on seeded native scenes", () => {
  expect(oracle.checksVersion).toBe("0.0.233")
  expect(oracle.checksSha256).toBe(
    "7b2a2f58ceaad44bf7151016934d5760a3fdc092f8e6989f9824ecbfcca314cd",
  )
  expect(oracle.results.length).toBe(172)
  for (let seed = 0; seed < 172; seed++) {
    const { input, traces } = createInput(seed)
    const original = JSON.stringify(traces)
    const scene = new PreparedNativeDrcScene(input)
    for (const includeContinuity of [false, true]) {
      const actual = scene.evaluate(traces, {
        includeTraceContinuity: includeContinuity,
      })
      const expected = oracle.results[seed]![includeContinuity ? 1 : 0]
      expect(
        JSON.parse(JSON.stringify(actual)) as unknown,
        `seed=${seed}, continuity=${includeContinuity}`,
      ).toEqual(expected)
    }
    expect(JSON.stringify(traces)).toBe(original)
  }
})
