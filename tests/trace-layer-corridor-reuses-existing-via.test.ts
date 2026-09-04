import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import {
  applyTraceLayerCorridorForError,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

test("a layer corridor joins overlapping same-net via copper without moving its existing route", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -3, maxX: 6, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    connections: ["own-corridor", "own-existing", "foreign"].map((name) => ({
      name,
      rootConnectionName: name === "foreign" ? name : "own",
      pointsToConnect: [],
    })),
    obstacles: [0, -0.3, -0.8].map((x) => ({
      type: "rect" as const,
      center: { x, y: 0 },
      width: 0.3,
      height: 1.2,
      layers: ["bottom"],
      connectedTo: [x === -0.8 ? "foreign" : "own"],
    })),
  }
  const sharedVia = { x: -0.1458, y: -0.6966 }
  const existingRoute: HighDensityRoute = {
    connectionName: "own-existing",
    rootConnectionName: "own",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: sharedVia.x, y: -2, z: 0, pcb_port_id: "far-terminal" },
      { ...sharedVia, z: 0 },
      { ...sharedVia, z: 1 },
      { x: 0, y: 0, z: 1, pcb_port_id: "shared-terminal" },
    ],
    vias: [sharedVia],
  }
  for (const reverseExistingRoute of [false, true]) {
    const input: HighDensityRoute[] = [
      {
        connectionName: "own-corridor",
        rootConnectionName: "own",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 4.5, y: 0, z: 1, pcb_port_id: "start-terminal" },
          { x: 4.5, y: -1.5, z: 1 },
          { x: 2, y: -1.5, z: 1 },
          { x: 0, y: 0, z: 1, pcb_port_id: "shared-terminal" },
        ],
        vias: [],
      },
      structuredClone(existingRoute),
      {
        connectionName: "foreign",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -1, y: -1.0369, z: 1 },
          { x: 3, y: -1.0369, z: 1 },
        ],
        vias: [],
      },
    ]
    if (reverseExistingRoute) input[1]!.route.reverse()
    const original = structuredClone(input)
    const engine = new AutoroutingDrcEngine(srj)
    const initial = getDrcSnapshot(srj, input, undefined, undefined, engine)
    const crossing = initial.errors.find(
      (error) => error.type === "pcb_trace_error",
    )!
    expect(crossing).toBeDefined()
    const candidate = cloneRoutes(input)
    expect(
      applyTraceLayerCorridorForError(srj, candidate, crossing, 0, 0, 1, 1),
    ).toBe(true)
    const output = materializeRoutes(candidate)
    expect(
      getDrcSnapshot(srj, output, undefined, undefined, engine).errors,
    ).toHaveLength(0)
    expect(output[0]!.vias).toContainEqual(sharedVia)
    expect(output[1]).toEqual(original[1])
    expect(output[2]).toEqual(original[2])
    expect(output[0]!.route[0]).toEqual(original[0]!.route[0])
    expect(output[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
    const physicalSites = new Set(
      output.flatMap((route) =>
        route.vias.map((via) => `${via.x},${via.y}`),
      ),
    )
    // Only the opposite end needs a new drilled site. The existing shared
    // via remains fixed, including when traversed in the reverse direction.
    expect(physicalSites.size).toBe(2)
    const newVia = output[0]!.vias.find((via) => via.x !== sharedVia.x)!
    expect(newVia.x).toBeCloseTo(4.3)
    expect(input).toEqual(original)

    for (const incompatible of ["net", "radius", "layers"] as const) {
      const incompatibleSrj = structuredClone(srj)
      const incompatibleInput = structuredClone(input)
      const attachedRoute = incompatibleInput[1]!
      if (incompatible === "net") attachedRoute.rootConnectionName = "foreign"
      if (incompatible === "radius") attachedRoute.viaDiameter = 0.4
      if (incompatible === "layers") {
        incompatibleSrj.layerCount = 4
        for (const pad of incompatibleSrj.obstacles) pad.layers = ["inner1"]
        for (const point of attachedRoute.route) {
          if (point.z === 1) point.z = 2
        }
      }
      const untouchedAttachedRoute = structuredClone(attachedRoute)
      const incompatibleCandidate = cloneRoutes(incompatibleInput)
      expect(
        applyTraceLayerCorridorForError(
          incompatibleSrj,
          incompatibleCandidate,
          crossing,
          0,
          0,
          1,
          1,
        ),
      ).toBe(true)
      const incompatibleOutput = materializeRoutes(incompatibleCandidate)
      expect(incompatibleOutput[0]!.vias).not.toContainEqual(sharedVia)
      expect(incompatibleOutput[1]).toEqual(untouchedAttachedRoute)
    }
  }
})
