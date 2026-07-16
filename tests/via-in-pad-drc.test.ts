import { expect, test } from "bun:test"
import {
  applyTerminalViaRelocationForError,
  applyViaInPadLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { GlobalDrcForceImproveSolver } from "../lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"
import type { DrcEvaluator } from "../lib/solvers/GlobalDrcForceImproveSolver/types"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../types/high-density-types"

test("terminal via relocation moves a surface escape span onto the inner layer", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1.5, y: 0, layer: "top", pointId: "start" },
          { x: 1.5, y: 0, layer: "bottom", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1.5, y: 0, z: 0, pcb_port_id: "start" },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1.5, y: 0, z: 1, pcb_port_id: "end" },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const before = getDrcSnapshot(srj, [route])
  const candidateRoutes = cloneRoutes([route])
  const changed = applyTerminalViaRelocationForError(
    srj,
    candidateRoutes,
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_id: "pcb_smtpad_foreign",
      pcb_trace_id: "trace_0",
      center: { x: -0.5, y: 0 },
    },
    new Map([["trace_0", 0]]),
    "start",
  )
  const materialized = materializeRoutes(candidateRoutes)
  const after = getDrcSnapshot(srj, materialized)

  expect(changed).toBe(true)
  expect(after.count).toBeLessThan(before.count)
  expect(materialized[0]?.route.map((point) => point.z)).toEqual([0, 1, 1, 1])
  expect(materialized[0]?.vias).toEqual([{ x: -1.5, y: 0 }])
})

test("via-in-pad layer move lowers full DRC on a terminal route", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "end"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1.5, y: 0, layer: "top", pointId: "start" },
          { x: 1.5, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1.5, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1.5, y: 0, z: 0, pcb_port_id: "end" },
    ],
    vias: [],
  }
  const before = getDrcSnapshot(srj, [route])
  const candidateRoutes = cloneRoutes([route])
  const changed = applyViaInPadLayerMoveForError(
    srj,
    candidateRoutes,
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_id: "pcb_smtpad_foreign",
      pcb_trace_id: "trace_0",
      center: { x: 0, y: 0 },
    },
    new Map([["trace_0", 0]]),
    1,
  )
  const materialized = materializeRoutes(candidateRoutes)
  const after = getDrcSnapshot(srj, materialized)

  expect(changed).toBe(true)
  expect(after.count).toBeLessThan(before.count)
  expect(materialized[0]?.route.map((point) => point.z)).toEqual([0, 1, 1, 0])
})

test("via-in-pad candidates can use a dedicated acceptance evaluator", () => {
  const padTraceError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pcb_smtpad_foreign",
    pcb_trace_id: "trace_0",
    center: { x: 0, y: 0 },
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1.5, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["trace", "end"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1.5, y: 0, layer: "top", pointId: "start" },
          { x: 1.5, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1.5, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1.5, y: 0, z: 0, pcb_port_id: "end" },
    ],
    vias: [],
  }
  const drcEvaluator: DrcEvaluator = () => ({
    errors: [padTraceError],
    errorsWithCenters: [padTraceError],
  })
  const viaInPadDrcEvaluator: DrcEvaluator = ({ routes }) => {
    const movedToInnerLayer = routes?.[0]?.route.some((point) => point.z === 1)
    return movedToInnerLayer
      ? { errors: [], errorsWithCenters: [] }
      : { errors: [padTraceError], errorsWithCenters: [padTraceError] }
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: [route],
    drcEvaluator,
    viaInPadDrcEvaluator,
    enableViaInPadLayerMoves: true,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    maxIterations: 1,
  })

  solver.solve()

  expect(solver.getOutput()[0]?.route.map((point) => point.z)).toEqual([
    0, 1, 1, 0,
  ])
})
