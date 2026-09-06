import { expect, test } from "bun:test"
import { wire } from "./fixtures/immutable-geometry-fixture"
import {
  createRectAabbFixture,
  expectRectAabbParity,
} from "./fixtures/rect-aabb-fixture"
test("rectangle axial precheck preserves copper width and epsilon decisions on both sides of the clearance threshold", (): void => {
  for (const offset of [0, -17, 1e6, -1e12, 1e12])
    for (const width of [0, 0.1, 0.8])
      for (const traceClearance of [0.1, 0.3])
        for (const delta of [
          -1e-6, -1e-10, 0, 1e-10, 5e-10, 1e-9, 2e-9, 1e-6,
        ]) {
          const y = offset + 0.5 + width / 2 + traceClearance - 0.005 + delta
          expectRectAabbParity(
            createRectAabbFixture(offset),
            [
              wire(
                "threshold",
                "trace_net",
                [
                  [offset - 2, y],
                  [offset + 2, y],
                ],
                width,
              ),
            ],
            { traceClearance },
          )
        }
  const srj = createRectAabbFixture()
  expect(
    expectRectAabbParity(srj, [
      wire(
        "near",
        "trace_net",
        [
          [-2, 0.64],
          [2, 0.64],
        ],
        0.1,
      ),
    ]).errors.length,
  ).toBe(1)
  expect(
    expectRectAabbParity(srj, [
      wire(
        "far",
        "trace_net",
        [
          [-2, 0.65],
          [2, 0.65],
        ],
        0.1,
      ),
    ]).errors.length,
  ).toBe(0)
})
