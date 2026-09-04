import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("same-layer repeats require new via placement while real stacked transitions stay fixed", () => {
  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      { name: "horizontal", pointsToConnect: [] },
      { name: "vertical", pointsToConnect: [] },
    ],
    obstacles: [-0.6, 0.6].map((x) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 0.2,
      height: 0.3,
      connectedTo: ["horizontal"],
    })),
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: -2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj)
  const before = getDrcSnapshot(srj, input, undefined, undefined, engine)
  expect(before.errors).toMatchObject([{ type: "pcb_trace_error" }])
  const candidates = cloneRoutes(input)
  expect(
    applySafeTraceLayerMoveForError(
      srj,
      candidates,
      before.errors[0]!,
      0,
      1,
      0,
    ),
  ).toBe(true)
  const output = materializeRoutes(candidates)
  expect(output[0]!.vias).toHaveLength(2)
  for (const via of output[0]!.vias) {
    for (const pad of srj.obstacles) {
      const centerToPadDistance = Math.hypot(
        Math.max(0, Math.abs(via.x - pad.center.x) - pad.width / 2),
        Math.max(0, Math.abs(via.y - pad.center.y) - pad.height / 2),
      )
      expect(centerToPadDistance).toBeGreaterThanOrEqual(0.15)
    }
  }
  expect(
    getDrcSnapshot(srj, output, undefined, undefined, engine).errors,
  ).toHaveLength(0)
  expect(output[0]!.route[0]).toEqual(input[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(input[0]!.route.at(-1))

  // Same-layer duplicates can also follow a genuine transition. Scan past
  // them so the existing pad attachments remain at their physical sites.
  const attachedSrj: SimpleRouteJson = {
    ...srj,
    obstacles: [-0.5, 0.5].map((x) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["horizontal"],
    })),
  }
  const attached: HighDensityRoute = {
    ...input[0]!,
    vias: [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }],
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 1 },
      { x: -0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }
  const attachedCandidates = cloneRoutes([attached])
  expect(
    applySafeTraceLayerMoveForError(
      attachedSrj,
      attachedCandidates,
      { type: "pcb_trace_error", center: { x: 0, y: 0 } },
      0,
      2,
      0,
    ),
  ).toBe(true)
  const attachedOutput = materializeRoutes(attachedCandidates)[0]!
  expect(attachedOutput.vias).toEqual(attached.vias)
  expect(attachedOutput.route[0]).toEqual(attached.route[0])
  expect(attachedOutput.route.at(-1)).toEqual(attached.route.at(-1))
  for (const via of attached.vias) {
    const layersAtVia = new Set(
      attachedOutput.route
        .filter((point) => point.x === via.x && point.y === via.y)
        .map((point) => point.z),
    )
    expect(layersAtVia).toEqual(new Set([0, 1, 2]))
  }
})
