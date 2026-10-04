import { expect, test } from "bun:test"
import {
  segmentToCircleMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { PreparedNativeDrcScene } from "../lib/drc/PreparedNativeDrcScene"
import { NativeDrcContactWorkspace } from "../lib/drc/native/NativeDrcContactWorkspace"
import { NativeDrcGrid } from "../lib/drc/native/nativeDrcGeometry"
import type {
  NativeDrcSceneInput,
  NativeDrcTrace,
} from "../lib/drc/native/nativeDrcTypes"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

// Explicit external audit mode can bind the independently pinned native source.
const BaselineDrcEngine: typeof AutoroutingDrcEngine = process.env
  .NATIVE_DRC_BASELINE_PATH
  ? (await import(process.env.NATIVE_DRC_BASELINE_PATH)).AutoroutingDrcEngine
  : AutoroutingDrcEngine

test("one candidate shares only exact directed geometry kernels while preserving the native objective and validation payload", () => {
  const nets = {
    net_a: ["a"],
    net_b: ["b"],
    net_c: ["c"],
    net_d: ["d", "pcb_plated_hole_circle", "pcb_smtpad_rotated"],
  }
  const connMap = new ConnectivityMap(nets)
  const input: NativeDrcSceneInput = {
    pads: [
      {
        id: "pcb_plated_hole_circle",
        kind: "plated_hole",
        shape: "circle",
        x: 0.35,
        y: 0.2,
        width: 0.24,
        height: 0.24,
        radius: 0.12,
        layers: ["top", "bottom"],
      },
      {
        id: "pcb_smtpad_rotated",
        kind: "smtpad",
        shape: "rect",
        x: -0.35,
        y: 0,
        width: 0.4,
        height: 0.2,
        rotation: 30,
        layers: ["top"],
      },
    ],
    holes: [],
    ports: [],
    sourceTraces: [
      { id: "a", portIds: [] },
      { id: "b", portIds: [] },
      { id: "c", portIds: [] },
    ],
    connectivity: connMap,
    createConnectivity: (_sources, traceLinks, viaOwnerLinks) => {
      const logical = new ConnectivityMap(
        Object.fromEntries(
          Object.entries(nets).map(([net, ids]) => [net, [...ids]]),
        ),
      )
      logical.addConnections(traceLinks)
      const clearance = new ConnectivityMap(
        Object.fromEntries(
          Object.entries(logical.netMap).map(([net, ids]) => [net, [...ids]]),
        ),
      )
      clearance.addConnections(viaOwnerLinks)
      return { logical, clearance }
    },
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    allowBlindAndBuriedVias: false,
    traceClearance: 0.1,
    viaHoleClearance: 0.1,
    holeClearance: 0.15,
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [
      {
        type: "rect",
        center: { x: 0.35, y: 0.2 },
        width: 0.24,
        height: 0.24,
        layers: ["top", "bottom"],
        connectedTo: ["pcb_plated_hole_circle"],
      },
      {
        type: "rect",
        center: { x: -0.35, y: 0 },
        width: 0.4,
        height: 0.2,
        ccwRotationDegrees: 30,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_rotated"],
      },
    ],
    connections: [
      { name: "a", pointsToConnect: [] },
      { name: "b", pointsToConnect: [] },
      { name: "c", pointsToConnect: [] },
    ],
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  }
  const engine = new AutoroutingDrcEngine(srj, { connMap })
  const baseline = new BaselineDrcEngine(srj, { connMap })
  const scene = new PreparedNativeDrcScene(input)
  let seed = 17
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < 128; i++) {
    const traces: NativeDrcTrace[] = [
      {
        pcb_trace_id: "a_trace",
        source_trace_id: "a",
        route: [
          {
            route_type: "wire",
            x: -1,
            y: 0,
            width: 0.08 + random() * 0.12,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.08 + random() * 0.12,
            layer: "top",
          },
        ],
      },
      {
        pcb_trace_id: "b_trace",
        source_trace_id: "b",
        route: [
          { route_type: "wire", x: -0.5, y: -1, width: 0.15, layer: "top" },
          {
            route_type: "wire",
            x: random() * 0.4,
            y: 1,
            width: 0.1,
            layer: "top",
          },
        ],
      },
      {
        pcb_trace_id: "c_trace",
        source_trace_id: "c",
        route: [
          { route_type: "wire", x: 0.4, y: 0.2, width: 0.12, layer: "top" },
          {
            route_type: "via",
            x: 0.4,
            y: 0.2,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 0.4, y: 0.2, width: 0.12, layer: "bottom" },
          { route_type: "wire", x: 1, y: 1, width: 0.12, layer: "bottom" },
        ],
      },
      {
        pcb_trace_id: "same_net_trace",
        source_trace_id: "a",
        route: [
          { route_type: "wire", x: -1, y: 0.05, width: 0.15, layer: "top" },
          { route_type: "wire", x: 1, y: 0.05, width: 0.15, layer: "top" },
        ],
      },
      {
        pcb_trace_id: "unowned_trace",
        source_trace_id: "",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: i % 2 === 0 ? 0 : 0.000001,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: i % 3 === 0 ? 0 : 0.5,
            y: i % 2 === 0 ? 0 : 0.000001,
            width: 0.2,
            layer: "top",
          },
        ],
      },
    ]
    const objectiveTraces: SimplifiedPcbTraces = traces.map((trace) => ({
      ...trace,
      type: "pcb_trace",
      connection_name: trace.source_trace_id,
    }))
    const prepared = scene.prepare(traces)
    const actual = engine.evaluate(objectiveTraces, prepared.contacts)
    expect(actual).toEqual(baseline.evaluate(objectiveTraces))
    expect(engine.lastRunStats).toEqual(baseline.lastRunStats)
    const reference = scene.evaluatePrepared(prepared)
    expect(reference).toEqual(scene.evaluate(traces))
    expect(prepared.contacts.stats.segmentCacheHits).toBeGreaterThan(0)
    expect(prepared.contacts.stats.circleCacheHits).toBeGreaterThan(0)
    expect(engine.evaluateLegacy(objectiveTraces, prepared.contacts)).toEqual(
      baseline.evaluateLegacy(objectiveTraces),
    )
  }
  const workspace = new NativeDrcContactWorkspace()
  const a = { x: -0, y: 0 },
    b = { x: 1, y: 0 },
    c = { x: 0, y: 1 },
    d = { x: 1, y: 1 }
  expect(workspace.segmentDistance(a, b, c, d)).toBe(
    segmentToSegmentMinDistance(a, b, c, d),
  )
  expect(workspace.segmentDistance(c, d, a, b)).toBe(
    segmentToSegmentMinDistance(c, d, a, b),
  )
  c.y = 2
  expect(workspace.segmentDistance(a, b, c, d)).toBe(
    segmentToSegmentMinDistance(a, b, c, d),
  )
  for (const radius of [0, 0.1, 0.5])
    expect(workspace.circleDistance(a, b, { ...c, radius })).toBe(
      segmentToCircleMinDistance(a, b, { ...c, radius }),
    )
  expect(() =>
    workspace.segmentDistance({ x: Infinity, y: 0 }, b, c, d),
  ).toThrow("Non-finite")
  expect(
    () =>
      new NativeDrcGrid([{ x: Infinity }], () => ({
        minX: 0,
        minY: 0,
        maxX: Infinity,
        maxY: 0,
      })),
  ).toThrow("Invalid native DRC grid bounds")
  expect(
    () =>
      new NativeDrcGrid([{}], () => ({
        minX: 1e308,
        minY: 0,
        maxX: 1e308,
        maxY: 0,
      })),
  ).toThrow("supported integer range")
  expect(
    () =>
      new NativeDrcGrid([{}], () => ({
        minX: 1e17,
        minY: 0,
        maxX: 1e17,
        maxY: 0,
      })),
  ).toThrow("supported integer range")
  const grid = new NativeDrcGrid([{}], () => ({
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
  }))
  expect(() =>
    grid.query({ minX: 1e308, minY: 0, maxX: 1e308, maxY: 0 }, 1e308),
  ).toThrow("supported integer range")
  expect(() => scene.prepare([], { traceClearance: Infinity })).toThrow(
    "candidate trace clearance",
  )
  expect(
    () =>
      new PreparedNativeDrcScene({
        ...input,
        ports: [{ id: "invalid", x: NaN, y: 0, layers: ["top"] }],
      }),
  ).toThrow("Non-finite")
  expect(
    () =>
      new PreparedNativeDrcScene({
        ...input,
        pads: [{ ...input.pads[1]!, width: -0.2 }],
      }),
  ).toThrow("pad dimensions")
})
