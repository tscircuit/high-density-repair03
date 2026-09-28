import { expect, test } from "bun:test"
import { wire } from "./fixtures/immutable-geometry-fixture"
import {
  createRectAabbFixture,
  expectRectAabbParity,
} from "./fixtures/rect-aabb-fixture"
test("overlapping AABBs, diagonal corners, crossings and endpoints retain the full rectangle distance result", (): void => {
  const cases: { points: Array<[number, number]>; error: boolean }[] = [
    {
      points: [
        [-3, 5],
        [5, -3],
      ],
      error: false,
    },
    {
      points: [
        [0.61, 0.61],
        [2, 0.61],
      ],
      error: false,
    },
    {
      points: [
        [0.6, 0.6],
        [2, 0.6],
      ],
      error: true,
    },
    {
      points: [
        [-2, 0],
        [2, 0],
      ],
      error: true,
    },
    {
      points: [
        [0, 0],
        [3, 3],
      ],
      error: true,
    },
    {
      points: [
        [-2, 0.5],
        [-0.5, 0.5],
      ],
      error: true,
    },
    {
      points: [
        [0.8, 0.8],
        [0.8, 0.8],
      ],
      error: false,
    },
  ]
  for (const offset of [0, -7])
    for (const entry of cases) {
      const points = entry.points.map(([x, y]): [number, number] => [
        x + offset,
        y + offset,
      ])
      const result = expectRectAabbParity(createRectAabbFixture(offset), [
        wire("geometry", "trace_net", points, 0.1),
      ])
      expect(result.errors.length > 0).toBe(entry.error)
    }
})
