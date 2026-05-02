import {
  applyDrcErrorForces,
  cloneRoutes,
  describe,
  expect,
  test,
} from "./solver-test-helpers"
import type { SimpleRouteJson } from "./solver-test-helpers"

describe("GlobalDrcForceImproveSolver", () => {
  test("does not push an obstacle-repair segment run outside board outline", () => {
    const srj: SimpleRouteJson = {
      bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
      outline: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 4.6 },
          width: 1.2,
          height: 0.8,
          layers: ["top"],
          connectedTo: ["other_net"],
        },
      ],
      layerCount: 2,
      minTraceWidth: 0.2,
      minViaDiameter: 0.3,
    }
    const routes = cloneRoutes([
      {
        connectionName: "A",
        rootConnectionName: "A",
        route: [
          { x: -4.5, y: 4.2, z: 0 },
          { x: -4.5, y: 4.8, z: 0 },
          { x: 0, y: 4.8, z: 0 },
          { x: 4.5, y: 4.8, z: 0 },
          { x: 4.5, y: 4.2, z: 0 },
        ],
        vias: [],
        traceThickness: 0.2,
        viaDiameter: 0.3,
      },
    ])

    const changed = applyDrcErrorForces(
      srj,
      routes,
      [
        {
          message: "pcb_trace overlaps pcb_smtpad",
          pcb_trace_id: "trace_0",
          center: { x: 0, y: 4.8 },
        },
      ],
      new Map([["trace_0", 0]]),
      1,
    )

    expect(changed).toBe(false)
    expect(routes[0]?.route).toEqual([
      { x: -4.5, y: 4.2, z: 0 },
      { x: -4.5, y: 4.8, z: 0 },
      { x: 0, y: 4.8, z: 0 },
      { x: 4.5, y: 4.8, z: 0 },
      { x: 4.5, y: 4.2, z: 0 },
    ])
  })

  test("does not push a near-edge trace segment closer to the board boundary", () => {
    const srj: SimpleRouteJson = {
      bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
      outline: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect",
          center: { x: 4.425, y: 0 },
          width: 0.2,
          height: 0.8,
          layers: ["top"],
          connectedTo: ["other_net"],
        },
      ],
      layerCount: 2,
      minTraceWidth: 0.2,
      minViaDiameter: 0.3,
    }
    const routes = cloneRoutes([
      {
        connectionName: "A",
        rootConnectionName: "A",
        route: [
          { x: 4.75, y: -1, z: 0 },
          { x: 4.75, y: 1, z: 0 },
        ],
        vias: [],
        traceThickness: 0.2,
        viaDiameter: 0.3,
      },
    ])

    const changed = applyDrcErrorForces(
      srj,
      routes,
      [
        {
          message: "pcb_trace overlaps pcb_smtpad",
          pcb_trace_id: "trace_0",
          center: { x: 4.6, y: 0 },
        },
      ],
      new Map([["trace_0", 0]]),
      1,
    )

    expect(changed).toBe(false)
    expect(routes[0]?.route).toEqual([
      { x: 4.75, y: -1, z: 0 },
      { x: 4.75, y: 1, z: 0 },
    ])
  })

  test("clips outward via motion and keeps tangential slide near the boundary", () => {
    const srj: SimpleRouteJson = {
      bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
      outline: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.2,
      minViaDiameter: 0.3,
    }
    const routes = cloneRoutes([
      {
        connectionName: "A",
        rootConnectionName: "A",
        route: [
          { x: 4.7, y: -1, z: 0 },
          { x: 4.7, y: 0, z: 0 },
          { x: 4.7, y: 0, z: 1 },
          { x: 4.7, y: 1, z: 1 },
        ],
        vias: [],
        traceThickness: 0.2,
        viaDiameter: 0.3,
      },
    ])

    const changed = applyDrcErrorForces(
      srj,
      routes,
      [
        {
          message: "pcb_via clearance issue",
          pcb_via_ids: ["pcb_via_0"],
          center: { x: 4.5, y: -0.3 },
        },
      ],
      new Map(),
      1,
    )

    expect(changed).toBe(true)
    expect(routes[0]?.route[1]?.x).toBeCloseTo(4.7, 6)
    expect(routes[0]?.route[2]?.x).toBeCloseTo(4.7, 6)
    expect(routes[0]?.route[1]?.y ?? 0).toBeGreaterThan(0)
    expect(routes[0]?.route[2]?.y).toBeCloseTo(routes[0]?.route[1]?.y ?? 0, 6)
  })

  test("does not let a trace jump into the board-edge zone in one move", () => {
    const srj: SimpleRouteJson = {
      bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
      outline: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
      connections: [{ name: "A", pointsToConnect: [] }],
      obstacles: [
        {
          type: "rect",
          center: { x: 4.37, y: 0 },
          width: 0.2,
          height: 0.8,
          layers: ["top"],
          connectedTo: ["other_net"],
        },
      ],
      layerCount: 2,
      minTraceWidth: 0.2,
      minViaDiameter: 0.3,
    }
    const routes = cloneRoutes([
      {
        connectionName: "A",
        rootConnectionName: "A",
        route: [
          { x: 4.5, y: -1, z: 0 },
          { x: 4.5, y: 1, z: 0 },
        ],
        vias: [],
        traceThickness: 0.2,
        viaDiameter: 0.3,
      },
    ])

    const changed = applyDrcErrorForces(
      srj,
      routes,
      [
        {
          message: "pcb_trace overlaps pcb_smtpad",
          pcb_trace_id: "trace_0",
          center: { x: 4.435, y: 0 },
        },
      ],
      new Map([["trace_0", 0]]),
      1,
    )

    expect(changed).toBe(false)
    expect(routes[0]?.route).toEqual([
      { x: 4.5, y: -1, z: 0 },
      { x: 4.5, y: 1, z: 0 },
    ])
  })
})
