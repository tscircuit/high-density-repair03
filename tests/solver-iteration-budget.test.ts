import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "../lib"

test("scales max iterations with initial DRC error count", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes: [],
    drcEvaluator: () =>
      Array.from({ length: 43 }, (_, index) => ({
        message: `synthetic DRC ${index}`,
      })),
  })

  expect(solver.MAX_ITERATIONS).toBe(48)

  solver.step()

  expect(solver.MAX_ITERATIONS).toBe(115)
  expect(solver.stats.globalDrcForceImproveMaxIterations).toBe(115)
})

test("honors explicit max iterations over DRC-scaled budget", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes: [],
    maxIterations: 12,
    drcEvaluator: () =>
      Array.from({ length: 43 }, (_, index) => ({
        message: `synthetic DRC ${index}`,
      })),
  })

  solver.step()

  expect(solver.MAX_ITERATIONS).toBe(12)
  expect(solver.stats.globalDrcForceImproveMaxIterations).toBe(12)
})

test("stops after two DRC-count plateau checks", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes: [],
    drcEvaluator: () =>
      Array.from({ length: 3 }, (_, index) => ({
        message: `synthetic centered DRC ${index}`,
        center: { x: index + 1, y: 5 },
      })),
  })

  for (let index = 0; index < 3; index += 1) {
    solver.step()
    expect(solver.solved).toBe(false)
  }

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.MAX_ITERATIONS).toBe(48)
  expect(solver.stats.globalDrcForceImproveStalledIterations).toBe(0)
  expect(solver.stats.globalDrcForceImproveDrcCountPlateauChecks).toBe(2)
})

test("does not plateau-stop high DRC boards before broad fallback window", () => {
  const solver = new GlobalDrcForceImproveSolver({
    srj: {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
    },
    hdRoutes: [],
    drcEvaluator: () =>
      Array.from({ length: 36 }, (_, index) => ({
        message: `synthetic centered DRC ${index}`,
        center: { x: index, y: 5 },
      })),
  })

  for (let index = 0; index < 95; index += 1) {
    solver.step()
    expect(solver.solved).toBe(false)
  }

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.MAX_ITERATIONS).toBe(96)
  expect(solver.stats.globalDrcForceImproveDrcCountPlateauChecks).toBe(0)
})

test("stops large-route boards after repeated broad fallback misses", () => {
  const srj = {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes = Array.from({ length: 121 }, (_, index) => ({
    connectionName: `A${index}`,
    route: [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }))
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    drcEvaluator: () => [
      {
        message: "synthetic centered DRC",
        center: { x: 1, y: 1 },
      },
    ],
  })

  solver.step()

  expect(solver.MAX_ITERATIONS).toBe(192)
  for (let index = 1; index < 32; index += 1) {
    solver.step()
    expect(solver.solved).toBe(false)
  }

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.stats.globalDrcForceImproveLargeBoardBroadFallbackMisses).toBe(
    2,
  )
})
