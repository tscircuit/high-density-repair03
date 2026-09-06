import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../lib/types"

const wire = (
  id: string,
  net: string,
  x: number,
  y: number,
): SimplifiedPcbTraces[number] => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: net,
  route: [
    { route_type: "wire", x: x - 0.2, y, width: 0.1, layer: "top" },
    { route_type: "wire", x: x + 0.2, y, width: 0.1, layer: "top" },
  ],
})
const via = (
  id: string,
  net: string,
  x: number,
  y: number,
): SimplifiedPcbTraces[number] => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: net,
  route: [
    {
      route_type: "via",
      x,
      y,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.3,
    },
  ],
})

test("cached obstacle membership preserves non-idempotent aliases, duplicate IDs and complete ordered results", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 15, maxY: 8 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [
      {
        name: "A",
        rootConnectionName: "B",
        mergedConnectionNames: ["shared"],
        pointsToConnect: [],
      },
      {
        name: "B",
        rootConnectionName: "C",
        mergedConnectionNames: ["shared"],
        pointsToConnect: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["pcb_smtpad_chain", "C"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 4, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["pcb_smtpad_duplicate", "foreign", "pcb_port_foreign"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 8, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["pcb_smtpad_duplicate", "another_net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 5 },
        width: 1,
        height: 1,
        connectedTo: ["pcb_smtpad_unknown", "unknown_own"],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 12, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["pcb_plated_hole_ring", "foreign"],
      },
    ],
  }
  const original = structuredClone(srj)
  for (const obstacle of srj.obstacles) Object.freeze(obstacle.connectedTo)
  const ordinary = new AutoroutingDrcEngine(srj, {
    includeTraceViaOwnerMetadata: true,
  })
  const cached = new AutoroutingDrcEngine(srj, {
    cacheStaticObstacleNetMembership: true,
    includeTraceViaOwnerMetadata: true,
  })
  const initial: SimplifiedPcbTraces = [
    wire("chain_wire", "A", 0, 0),
    via("chain_via", "A", 0, 0),
    wire("collision_wire", "shared", 0, 0.2),
    wire("unknown_own_wire", "unknown_own", 0, 5),
    wire("foreign_wire", "unknown_signal", 4, 0),
    wire("skipped_duplicate_wire", "unknown_signal", 8, 0),
    via("foreign_via", "unknown_signal", 12, 0),
  ]
  const expected = ordinary.evaluate(initial)
  expect(expected.errors).toHaveLength(2)
  expect(expected.errors.map((error): string => error.type)).toEqual([
    "pcb_trace_error",
    "pcb_pad_pad_clearance_error",
  ])
  expect(expected.errors[0]?.pcb_trace_error_id).toBe(
    "overlap_foreign_wire_pcb_smtpad_duplicate",
  )
  expect(expected.errors[1]?.pcb_pad_ids).toEqual([
    "via_1",
    "pcb_plated_hole_ring",
  ])
  // A resolves to B in geometry, then B resolves to C in the obstacle check.
  // Comparing B directly with the cached obstacle C would change behavior.
  const changed = structuredClone(initial)
  changed[4] = wire("foreign_wire", "C", 0, 0.4)
  for (const traces of [initial, [...initial].reverse(), changed, initial]) {
    for (const method of ["evaluate", "evaluateLegacy"] as const) {
      expect(cached[method](traces)).toEqual(ordinary[method](traces))
      expect(cached.lastRunStats).toEqual(ordinary.lastRunStats)
      expect(cached.lastRunStats.obstacleCount).toBe(4)
    }
  }
  expect(srj).toEqual(original)
})
