import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getUsbCircuitRender } from "./fixtures/getUsbCircuitRender"

test("terminal escapes respect clearance and bounds on real USB routing input", async () => {
  const { phases } = await getUsbCircuitRender()
  // CC2 routing repairs the already-routed connector-to-fuse VBUS connection.
  const repair = phases[3]!.repairs[0]!
  const connMap = new ConnectivityMap(repair.netMap)
  const snapshot = getDrcSnapshot(repair.srj, repair.input, undefined, connMap)
  const error = snapshot.errors.find(
    (error) => error.type === "pcb_trace_error",
  )!
  expect(error).toBeDefined()
  if (typeof error.pcb_trace_id !== "string")
    throw new Error("Missing real DRC trace identity")
  const routeIndex = snapshot.traceRouteIndexById.get(error.pcb_trace_id)!
  expect(routeIndex).toBeDefined()
  const originalRoute = repair.input[routeIndex]!
  expect(originalRoute.vias).toHaveLength(0)
  const endpoints = [originalRoute.route[0]!, originalRoute.route.at(-1)!]
  const terminalPads = endpoints.map(
    (endpoint) =>
      repair.srj.obstacles.find(
        (pad) =>
          pad.connectedTo.includes(endpoint.pcb_port_id!) &&
          Math.abs(endpoint.x - pad.center.x) <= pad.width / 2 &&
          Math.abs(endpoint.y - pad.center.y) <= pad.height / 2,
      )!,
  )
  expect(terminalPads.every(Boolean)).toBe(true)

  for (const clearanceMm of [undefined, 0, 0.1, 0.25, 4]) {
    for (const directionVariant of [0, 1]) {
      const srj = { ...repair.srj, minViaEdgeToPadEdgeClearance: clearanceMm }
      const routes = cloneRoutes(repair.input)
      expect(
        applySafeTraceLayerMoveForError(
          srj,
          routes,
          error,
          routeIndex,
          1,
          "full",
          connMap,
          directionVariant,
        ),
      ).toBe(true)
      const moved = routes[routeIndex]!
      const transitions = moved.route.filter(
        (point, index) => index > 0 && moved.route[index - 1]!.z !== point.z,
      )
      expect(transitions).toHaveLength(2)
      for (const [index, via] of transitions.entries()) {
        const pad = terminalPads[index]!
        const gapMm =
          Math.hypot(
            Math.max(0, Math.abs(via.x - pad.center.x) - pad.width / 2),
            Math.max(0, Math.abs(via.y - pad.center.y) - pad.height / 2),
          ) -
          moved.viaDiameter / 2
        expect(gapMm).toBeGreaterThanOrEqual(clearanceMm ?? 0.1)
        expect(gapMm).toBeLessThan((clearanceMm ?? 0.1) + 0.000003)
      }
      expect(moved.route[0]).toEqual(endpoints[0])
      expect(moved.route.at(-1)).toEqual(endpoints[1])
      expect(routes.filter((_, index) => index !== routeIndex)).toEqual(
        repair.input.filter((_, index) => index !== routeIndex),
      )
    }
  }

  const routes = cloneRoutes(repair.input)
  expect(
    applySafeTraceLayerMoveForError(
      { ...repair.srj, minViaEdgeToPadEdgeClearance: 100 },
      routes,
      error,
      routeIndex,
      1,
      "full",
      connMap,
    ),
  ).toBe(false)
  expect(routes).toEqual(repair.input)
}, 30_000)
