import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "../lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"

test("foreign-pad repulsion cannot turn an external via into an own-pad attachment", () => {
  const srj: SimpleRouteJson & { allowViaInPad: false } = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
    allowViaInPad: false,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [{ name: "own-net", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.7,
        height: 0.7,
        layers: ["top"],
        connectedTo: ["own-net", "pcb_smtpad_own"],
      },
      {
        type: "rect",
        center: { x: 0.65, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "own-net",
      rootConnectionName: "own-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_own" },
        { x: 0.506, y: 0, z: 0 },
        { x: 0.506, y: 0, z: 1 },
        { x: -1, y: 1, z: 1 },
      ],
      vias: [{ x: 0.506, y: 0 }],
    },
    {
      connectionName: "unrelated-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1.5, y: -1.8, z: 1 },
        { x: -1.5, y: -0.5, z: 1 },
      ],
      vias: [],
    },
  ]
  const input = structuredClone(routes)
  const output = applyViaToPadClearanceRelaxation(srj, routes, undefined, 0)
  const via = output[0]!.vias[0]!
  const distanceToOwnPad = Math.hypot(
    Math.max(Math.abs(via.x) - 0.35, 0),
    Math.max(Math.abs(via.y) - 0.35, 0),
  )

  // The old placement moved the via to x=0.244, inside its own pad, and
  // incorrectly declared the candidate DRC-clean. No legal gap exists between
  // the pads; this local relaxation need not find a detour around both pads.
  expect(distanceToOwnPad).toBeGreaterThanOrEqual(output[0]!.viaDiameter / 2)
  expect(output).toEqual(input)
  expect(routes).toEqual(input)
  const snapshot = getDrcSnapshot(
    srj,
    output,
    undefined,
    undefined,
    new AutoroutingDrcEngine(srj),
  )
  expect(snapshot.errors.some((error) => error.pcb_via_ids)).toBe(true)

  // A genuinely pre-existing attachment remains exempt, including when its
  // via is an interior point rather than an immovable tagged endpoint.
  const attachedRoute: HighDensityRoute = {
    ...input[0]!,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 1, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const attachedRoutes = [attachedRoute]
  expect(
    applyViaToPadClearanceRelaxation(srj, attachedRoutes, undefined, 0),
  ).toBe(attachedRoutes)
})
