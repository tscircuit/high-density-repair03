import { expect, test } from "bun:test"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getLegacyFirstRepairErrors,
  getDrcSnapshot,
  getRepairDrcIssueCount,
  getRepairDrcIssueScore,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"

test("moves only the via reported by a via-to-pad clearance error", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      { name: "via_net", pointsToConnect: [] },
      { name: "other_via_net", pointsToConnect: [] },
      { name: "pad_net", pointsToConnect: [] },
      { name: "distractor_net", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.2, y: 0.1 },
        width: 0.1,
        height: 0.1,
        connectedTo: ["pcb_smtpad_distractor", "distractor_net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "pad_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes = cloneRoutes([
    {
      connectionName: "via_net",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "other_via_net",
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: 0.2, y: 0, z: 0 },
        { x: 0.2, y: 0, z: 1 },
        { x: 2, y: 0.5, z: 1 },
      ],
      vias: [{ x: 0.2, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_trace_id: "via_net_0",
        pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
        pcb_via_ids: ["via_0"],
        message:
          'pcb_via "via_0" and pcb_smtpad "pcb_smtpad_foreign" are too close',
        center: { x: 0.2, y: 0 },
      },
    ],
    new Map([["via_net_0", 0]]),
    1,
  )

  expect(changed).toBe(true)
  expect(routes[0]?.route[1]?.x).toBeLessThan(0)
  expect(routes[0]?.route[1]?.y).toBe(0)
  expect(routes[1]?.route[1]).toMatchObject({ x: 0.2, y: 0 })
})

test("does not trade a via-to-pad error for a pre-existing DRC type", () => {
  const traceRouteIndexById = new Map<string, number>()
  const bestSnapshot = {
    errors: [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_via_ids: ["via_0"],
      },
    ],
    count: 1,
    issueScore: 1,
    traceRouteIndexById,
  }
  const candidateSnapshot = {
    errors: [{ type: "pcb_trace_error" }],
    count: 1,
    issueScore: 0.1,
    traceRouteIndexById,
  }

  expect(isBetterDrcSnapshot(candidateSnapshot, 0, 1, 1, 1, bestSnapshot)).toBe(
    false,
  )
})

test("repairs legacy DRC errors before newly detected via-to-pad errors", () => {
  const viaPadError = {
    type: "pcb_pad_pad_clearance_error",
    pcb_via_ids: ["via_0"],
  }
  const traceError = { type: "pcb_trace_error" }
  const viaError = {
    type: "pcb_via_clearance_error",
    pcb_via_ids: ["via_1", "via_2"],
  }

  expect(
    getLegacyFirstRepairErrors([viaPadError, traceError, viaError]),
  ).toEqual([traceError, viaError])
  expect(getLegacyFirstRepairErrors([viaPadError])).toEqual([viaPadError])
})

test("does not spend the legacy repair budget on via-to-pad count changes", () => {
  const traceRouteIndexById = new Map<string, number>()
  const viaPadError = {
    type: "pcb_pad_pad_clearance_error",
    pcb_via_ids: ["via_0"],
  }
  const bestSnapshot = {
    errors: [{ type: "pcb_trace_error" }, viaPadError, viaPadError],
    count: 3,
    issueScore: 3,
    traceRouteIndexById,
  }
  const fewerViaPadErrors = {
    errors: [{ type: "pcb_trace_error" }],
    count: 1,
    issueScore: 1,
    traceRouteIndexById,
  }
  const legacyClean = {
    errors: [viaPadError, viaPadError],
    count: 2,
    issueScore: 2,
    traceRouteIndexById,
  }

  expect(getRepairDrcIssueCount(bestSnapshot)).toBe(1)
  expect(getRepairDrcIssueScore(bestSnapshot)).toBe(1)
  expect(isDrcSnapshotCountBetter(fewerViaPadErrors, bestSnapshot)).toBe(false)
  expect(isBetterDrcSnapshot(fewerViaPadErrors, 0, 1, 1, 0, bestSnapshot)).toBe(
    false,
  )
  expect(isDrcSnapshotCountBetter(legacyClean, bestSnapshot)).toBe(true)
  expect(isDrcSnapshotCountBetter(fewerViaPadErrors, legacyClean)).toBe(false)
})

test("keeps complete snapshots while prioritizing legacy DRC repairs", () => {
  const traceRouteIndexById = new Map<string, number>()
  const routes = [
    {
      connectionName: "net",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const srj = {
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    connections: [{ name: "net", pointsToConnect: [] }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const mixedErrors = [
    { type: "pcb_trace_error", center: { x: 0.5, y: 0 } },
    {
      type: "pcb_pad_pad_clearance_error",
      pcb_via_ids: ["via_0"],
      center: { x: 0.5, y: 0.5 },
    },
  ]
  const mixedSnapshot = getDrcSnapshot(srj, routes, () => ({
    errors: mixedErrors,
  }))
  const viaPadOnlySnapshot = getDrcSnapshot(srj, routes, () => ({
    errors: [
      {
        type: "pcb_pad_pad_clearance_error",
        pcb_via_ids: ["via_0"],
        center: { x: 0.5, y: 0.5 },
      },
    ],
  }))

  expect(mixedSnapshot).toMatchObject({
    count: 2,
    errors: [
      { type: "pcb_trace_error" },
      { type: "pcb_pad_pad_clearance_error" },
    ],
  })
  expect(viaPadOnlySnapshot).toMatchObject({
    count: 1,
    errors: [{ type: "pcb_pad_pad_clearance_error" }],
  })
  expect(
    isBetterDrcSnapshot(viaPadOnlySnapshot, 1, 1, 1, 0, {
      ...mixedSnapshot,
      traceRouteIndexById,
    }),
  ).toBe(true)
})
