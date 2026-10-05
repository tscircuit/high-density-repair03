import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import type { Point } from "../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import {
  applyBroadRepulsionForces,
  getSafeTranslationForPointIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { getFrozenSafeTranslationForPointIndexes } from "./fixtures/frozenBoardTranslation"

type MotionInput = {
  srj: SimpleRouteJson
  route: HighDensityRoute
  indexes: number[]
  dx: number
  dy: number
  radius: number
}

type Motion = (
  srj: SimpleRouteJson,
  route: HighDensityRoute,
  indexes: number[],
  dx: number,
  dy: number,
  radius: number,
) => Point | undefined

const makeInput = (): MotionInput => ({
  srj: {
    bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
    outline: [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
      { x: -10, y: -10 },
    ],
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
  },
  route: {
    connectionName: "signal",
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  indexes: [1],
  dx: 0.03,
  dy: -0.02,
  radius: 0.05,
})

const invoke = (motion: Motion, input: MotionInput): Point | undefined =>
  motion(
    input.srj,
    input.route,
    input.indexes,
    input.dx,
    input.dy,
    input.radius,
  )

const compare = (input: MotionInput): void => {
  expect(invoke(getSafeTranslationForPointIndexes, input)).toEqual(
    invoke(getFrozenSafeTranslationForPointIndexes, input),
  )
}

test("strict rectangular interior preserves frozen board translation and live input reads", () => {
  let seed = 0x41827365
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
  for (let index = 0; index < 1_500; index += 1) {
    const input = makeInput()
    const scale = [1, 10, 100, 500][index % 4]!
    const offsetX = (random() - 0.5) * 100
    const offsetY = (random() - 0.5) * 100
    input.srj.outline = input.srj.outline!.map((point) => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY,
    }))
    if (index % 2) input.srj.outline.reverse()
    if (index % 3 === 0) input.srj.outline.pop()
    const count = 3 + (index % 7)
    input.route.route = Array.from({ length: count }, (_, pointIndex) => ({
      x: ((random() - 0.5) * 19.8 + (pointIndex % 2) * 0.001) * scale + offsetX,
      y: (random() - 0.5) * 19.8 * scale + offsetY,
      z: pointIndex % 2,
    }))
    input.indexes = [1, count - 2, 1]
    input.dx = (random() - 0.5) * 0.3 * scale
    input.dy = (random() - 0.5) * 0.3 * scale
    input.radius = random() * 0.3
    input.srj.defaultObstacleMargin = random() * 0.4
    compare(input)
  }

  for (const number of [
    0,
    -0,
    1e-6,
    -1e-6,
    1e-3,
    -1e-3,
    Number.NaN,
    Infinity,
    -Infinity,
    1e200,
  ]) {
    const input = makeInput()
    input.dx = number
    compare(input)
    input.dx = 0.03
    input.route.route[1]!.x = number
    compare(input)
  }
  for (const gap of [
    0,
    1e-6,
    0.001,
    0.05,
    0.159,
    0.16,
    0.21,
    0.211,
    0.212,
    0.24,
    0.242 - 10 * Number.EPSILON,
    0.242,
    0.242 + 10 * Number.EPSILON,
    0.243,
  ]) {
    for (const direction of [-1, 1]) {
      const input = makeInput()
      input.route.route[0]!.x = 10 - gap
      input.route.route[1]!.x = 10 - gap
      input.route.route[2]!.x = 10 - gap
      input.dx = direction * 0.03
      compare(input)
    }
  }
  for (const outline of [
    undefined,
    [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 0, y: 10 },
    ],
    [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 0, y: 0 },
      { x: -10, y: 10 },
    ],
    [
      { x: -0.1, y: -0.1 },
      { x: 0.1, y: -0.1 },
      { x: 0.1, y: 0.1 },
      { x: -0.1, y: 0.1 },
    ],
  ]) {
    const input = makeInput()
    input.srj.outline = outline
    compare(input)
  }
  for (const neighborX of [-20, -9.999, -9.79, 9.79, 9.999, 20]) {
    const input = makeInput()
    input.route.route[0]!.x = neighborX
    compare(input)
  }
  for (const indexes of [[0], [2], [-1], [3], [Number.NaN], [1, 0, 2, 1]]) {
    const input = makeInput()
    input.indexes = indexes
    compare(input)
  }
  const sparse = makeInput()
  delete sparse.route.route[0]
  compare(sparse)
  delete sparse.route.route[1]
  compare(sparse)
  const inherited = makeInput()
  inherited.route.route[1] = Object.assign(Object.create({ x: 0, y: 0 }), {
    z: 0,
  })
  compare(inherited)
  for (const rotation of [0, 1, 2, 3]) {
    const input = makeInput()
    const vertices = input.srj.outline!.slice(0, 4)
    input.srj.outline = vertices
      .slice(rotation)
      .concat(vertices.slice(0, rotation))
    compare(input)
    input.srj.outline.push(input.srj.outline[0]!)
    compare(input)
  }
  for (const minX of [-10_000, 9_999, 10_000]) {
    const input = makeInput()
    input.srj.outline = [
      { x: minX, y: -0.5 },
      { x: minX + 1, y: -0.5 },
      { x: minX + 1, y: 0.5 },
      { x: minX, y: 0.5 },
    ]
    input.route.route = [
      { x: minX + 0.25, y: 0, z: 0 },
      { x: minX + 0.5, y: 0, z: 0 },
      { x: minX + 0.75, y: 0, z: 0 },
    ]
    compare(input)
  }
  const largeMotion = makeInput()
  largeMotion.srj.outline = [
    { x: -10_000, y: -10_000 },
    { x: 10_000, y: -10_000 },
    { x: 10_000, y: 10_000 },
    { x: -10_000, y: 10_000 },
  ]
  largeMotion.dx = 9_999.7
  largeMotion.dy = 0
  compare(largeMotion)
  const nearCoincident = makeInput()
  nearCoincident.route.route[0]!.x = -1e-162
  nearCoincident.route.route[2]!.x = 1e-162
  compare(nearCoincident)
  const live = makeInput()
  compare(live)
  live.srj.outline![1]!.x = 0.01
  compare(live)
  live.srj.outline = makeInput().srj.outline
  live.srj.defaultObstacleMargin = 9.95
  compare(live)
  live.route.route[0]!.x = -9.98
  compare(live)
  live.route.route[1]!.y = 9.98
  compare(live)
  live.indexes = [0, 2, 2]
  compare(live)
  live.indexes = []
  compare(live)

  for (const location of [
    "outline",
    "margin",
    "outline-index",
    "outline-x",
    "route",
    "route-index",
    "point-x",
  ] as const) {
    const run = (motion: Motion): unknown => {
      const input = makeInput()
      const reads: string[] = []
      const install = (object: object, key: string, value: unknown): void => {
        Object.defineProperty(object, key, {
          configurable: true,
          get: (): unknown => {
            reads.push(location)
            return value
          },
        })
      }
      if (location === "outline") {
        install(input.srj, "outline", input.srj.outline)
      }
      if (location === "margin") {
        install(input.srj, "defaultObstacleMargin", 0.1)
      }
      if (location === "outline-index") {
        install(input.srj.outline!, "0", input.srj.outline![0])
      }
      if (location === "outline-x") {
        install(input.srj.outline![0]!, "x", -10)
      }
      if (location === "route") {
        install(input.route, "route", input.route.route)
      }
      if (location === "route-index") {
        install(input.route.route, "1", input.route.route[1])
      }
      if (location === "point-x") {
        install(input.route.route[1]!, "x", 0)
      }
      return { result: invoke(motion, input), reads }
    }
    expect(run(getSafeTranslationForPointIndexes)).toEqual(
      run(getFrozenSafeTranslationForPointIndexes),
    )
  }
  const traceClearance = Object.getOwnPropertyDescriptor(
    RELAXED_DRC_OPTIONS,
    "traceClearance",
  )!
  try {
    const run = (motion: Motion): unknown => {
      const input = makeInput()
      let reads = 0
      Object.defineProperty(RELAXED_DRC_OPTIONS, "traceClearance", {
        configurable: true,
        get: (): number => {
          reads += 1
          input.srj.outline![0]!.y = -9.9
          return 0.1
        },
      })
      return { result: invoke(motion, input), reads }
    }
    expect(run(getSafeTranslationForPointIndexes)).toEqual(
      run(getFrozenSafeTranslationForPointIndexes),
    )
  } finally {
    Object.defineProperty(RELAXED_DRC_OPTIONS, "traceClearance", traceClearance)
  }

  // Complete force-pass goldens are generated from the frozen 5ec4410 helper.
  const forceInput = makeInput()
  forceInput.srj.obstacles = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      zLayers: [0],
      connectedTo: [],
    },
  ]
  const routes = applyBroadRepulsionForces(
    forceInput.srj,
    [forceInput.route],
    1,
  )
  expect(routes).toEqual([
    {
      ...forceInput.route,
      route: [
        { x: -2, y: 0, z: 0 },
        {
          x: 0.0021464065870794814,
          y: 0.4109157996739217,
          z: 0,
        },
        { x: 2, y: 0, z: 0 },
      ],
    },
  ])
})
