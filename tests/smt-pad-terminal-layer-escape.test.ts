import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "../lib"

const srj: SimpleRouteJson = {
  bounds: { minX: 7, minY: -39.85, maxX: 10.5, maxY: -34 },
  connections: [
    {
      name: "target_mst33",
      rootConnectionName: "target",
      pointsToConnect: [
        {
          x: 9.25,
          y: -38.55,
          layer: "top",
          pointId: "pcb_port_6",
          pcb_port_id: "pcb_port_6",
        },
        {
          x: 10.14,
          y: -34.1,
          layer: "bottom",
          pointId: "pcb_port_144",
          pcb_port_id: "pcb_port_144",
        },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 9.25, y: -38.55 },
      width: 0.35,
      height: 2.5,
      connectedTo: ["target", "target_mst33", "pcb_port_6"],
      obstacleId: "target-pad",
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 8.25, y: -38.55 },
      width: 0.35,
      height: 2.5,
      connectedTo: ["foreign-a", "pcb_port_10"],
      obstacleId: "foreign-pad-a",
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 7.75, y: -38.55 },
      width: 0.35,
      height: 2.5,
      connectedTo: ["foreign-b", "pcb_port_12"],
      obstacleId: "foreign-pad-b",
    },
  ],
  layerCount: 4,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.15,
}

const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "target_mst33",
    rootConnectionName: "target",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 9.25, y: -38.55, z: 0, pcb_port_id: "pcb_port_6" },
      { x: 9.25, y: -39.162, z: 0 },
      { x: 8.799, y: -39.613, z: 0 },
      { x: 8.65, y: -39.729, z: 0 },
      { x: 8.246, y: -39.785, z: 0 },
      { x: 7.962, y: -39.785, z: 0 },
      { x: 7.647, y: -39.785, z: 0 },
      { x: 7.35, y: -39.785, z: 0 },
      { x: 7.344, y: -39.583, z: 0 },
      { x: 7.344, y: -37.206, z: 0 },
      { x: 7.818, y: -36.732, z: 0 },
      { x: 7.946, y: -36.732, z: 0 },
      { x: 7.987, y: -36.535, z: 0 },
      { x: 7.987, y: -36.535, z: 1 },
      { x: 9.481, y: -36.579, z: 1 },
      { x: 9.672, y: -36.457, z: 1 },
      { x: 9.603, y: -36.334, z: 1 },
      { x: 9.603, y: -36.334, z: 3 },
      { x: 9.603, y: -34.637, z: 3 },
      { x: 10.14, y: -34.1, z: 3, pcb_port_id: "pcb_port_144" },
    ],
    vias: [
      { x: 7.987, y: -36.535 },
      { x: 9.603, y: -36.334 },
    ],
  },
]

const persistentErrors = Array.from({ length: 4 }, (_, errorIndex) => ({
  type: "pcb_trace_error",
  message: `unrelated DRC error ${errorIndex}`,
}))
const smtPadErrors = [
  {
    type: "pcb_trace_error",
    message: 'PCB trace target_mst33_0 overlaps pcb_smtpad "foreign-pad-a"',
    pcb_trace_id: "target_mst33_0",
    center: { x: 8.418, y: -39.761 },
  },
  {
    type: "pcb_trace_error",
    message: 'PCB trace target_mst33_0 overlaps pcb_smtpad "foreign-pad-b"',
    pcb_trace_id: "target_mst33_0",
    center: { x: 7.944, y: -39.785 },
  },
]
const evaluateDrc: DrcEvaluator = ({ routes }) => {
  const targetRoute = routes?.[0]?.route ?? []
  const terminalEscapeTransitionIndex = targetRoute.findIndex(
    (point, pointIndex) =>
      point.z === 0 && targetRoute[pointIndex + 1]?.z === 1,
  )
  const terminalEscape = targetRoute[terminalEscapeTransitionIndex]
  const usesTerminalLayerEscape =
    terminalEscapeTransitionIndex === 1 &&
    terminalEscape !== undefined &&
    terminalEscape.x < 9.2
  const currentSmtPadErrors = usesTerminalLayerEscape ? [] : smtPadErrors

  return {
    errors: [...currentSmtPadErrors, ...persistentErrors],
    errorsWithCenters: currentSmtPadErrors,
  }
}

test("visualizes a terminal trace trapped against foreign SMT pads", () => {
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    drcEvaluator: evaluateDrc,
    maxIterations: 32,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })
  const inputSnapshot = getDrcSnapshot(
    srj,
    inputRoutes,
    solver.drcEvaluator,
    solver.connMap,
    solver.autoroutingDrcEngine,
  )
  const beforeRepair = solver.visualize()

  solver.solve()

  const outputSnapshot = getDrcSnapshot(
    srj,
    solver.getOutput(),
    solver.drcEvaluator,
    solver.connMap,
    solver.autoroutingDrcEngine,
  )
  const afterRepair = solver.visualize()

  expect(inputSnapshot.count).toBeGreaterThan(0)
  expect(outputSnapshot.count).toBeLessThanOrEqual(inputSnapshot.count)
  expect(solver.failed).toBe(false)

  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally([beforeRepair, afterRepair], {
      titles: [
        `Before repair: ${inputSnapshot.count} DRC errors`,
        `After repair: ${outputSnapshot.count} DRC errors`,
      ],
    }),
    { backgroundColor: "white" },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/smt-pad-terminal-layer-escape.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
