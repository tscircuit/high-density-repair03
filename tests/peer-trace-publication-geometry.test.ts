import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../lib"
import { hasNewTraceCopperOverlaps } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { snapshot } from "./fixtures/traceObstacleOverlapFixtures"

const route = (
  name: string,
  points: Array<[number, number, number]>,
  width = 0.2,
): HighDensityRoute => ({
  connectionName: name,
  rootConnectionName: name,
  traceThickness: width,
  viaDiameter: 0.3,
  route: points.map(([x, y, z]) => ({ x, y, z })),
  vias: [],
})

test("publication detects physical peer copper independently of error IDs and fragment order", (): void => {
  const horizontal = route("left", [
    [-1, 0, 0],
    [1, 0, 0],
  ])
  const vertical = route("right", [
    [0, -1, 0],
    [0, 1, 0],
  ])
  const original = [
    horizontal,
    route("right", [
      [2, -1, 0],
      [2, 1, 0],
    ]),
  ]
  for (const [xOffset, yOffset, rotation] of [
    [0, 0, 0],
    [1_000, -2_000, Math.PI / 4],
    [-23, 17, Math.PI / 2],
  ]) {
    const transform = (routes: HighDensityRoute[]): HighDensityRoute[] =>
      routes.map((entry) => ({
        ...entry,
        route: entry.route.map((point) => ({
          ...point,
          x:
            point.x * Math.cos(rotation!) -
            point.y * Math.sin(rotation!) +
            xOffset!,
          y:
            point.x * Math.sin(rotation!) +
            point.y * Math.cos(rotation!) +
            yOffset!,
        })),
      }))
    expect(
      hasNewTraceCopperOverlaps(
        snapshot([]),
        snapshot([]),
        transform([horizontal, vertical]),
        transform(original),
      ),
    ).toBeTrue()
  }

  // Positive clearance errors and opaque/reused IDs cannot hide real copper.
  const misleading = snapshot([
    { type: "pcb_trace_error", actual_clearance: 0.05 },
  ])
  expect(
    hasNewTraceCopperOverlaps(
      misleading,
      snapshot([]),
      [horizontal, vertical],
      original,
    ),
  ).toBeTrue()
  for (const [gap, overlaps] of [
    [0.198, true],
    [0.2, false],
    [0.201, false],
  ] as const) {
    const parallel = route("right", [
      [-1, gap, 0],
      [1, gap, 0],
    ])
    expect(
      hasNewTraceCopperOverlaps(
        snapshot([]),
        snapshot([]),
        [horizontal, parallel],
        original,
      ),
    ).toBe(overlaps)
  }
  const otherLayer = route("right", [
    [0, -1, 1],
    [0, 1, 1],
  ])
  expect(
    hasNewTraceCopperOverlaps(
      snapshot([]),
      snapshot([]),
      [horizontal, otherLayer],
      original,
    ),
  ).toBeFalse()
  const aliases = new ConnectivityMap({ shared: ["left", "right"] })
  expect(
    hasNewTraceCopperOverlaps(
      snapshot([]),
      snapshot([]),
      [horizontal, vertical],
      original,
      aliases,
    ),
  ).toBeFalse()
  const throughObstacle = structuredClone(horizontal)
  throughObstacle.route[0]!.toNextSegmentType = "through_obstacle"
  expect(
    hasNewTraceCopperOverlaps(
      snapshot([]),
      snapshot([]),
      [throughObstacle, vertical],
      original,
    ),
  ).toBeFalse()

  const split = [
    route("right", [
      [0, -1, 0],
      [0, 0, 0],
    ]),
    horizontal,
    route("right", [
      [0, 0, 0],
      [0, 1, 0],
    ]),
  ]
  expect(
    hasNewTraceCopperOverlaps(snapshot([]), snapshot([]), split, [
      horizontal,
      vertical,
    ]),
  ).toBeFalse()
  expect(
    hasNewTraceCopperOverlaps(snapshot([]), snapshot([]), original, [
      horizontal,
      vertical,
    ]),
  ).toBeFalse()
})
