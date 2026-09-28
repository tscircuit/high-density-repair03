import { expect, test } from "bun:test"
import { wire, via } from "./fixtures/immutable-geometry-fixture"
import {
  createRectAabbFixture,
  expectRectAabbParity,
} from "./fixtures/rect-aabb-fixture"
test("circular obstacles keep the original radius-aware path even when their nominal width is smaller than their diameter", (): void => {
  const srj = createRectAabbFixture()
  srj.obstacles[0]!.layers = ["top", "bottom"]
  srj.obstacles[0]!.height = 1.0008
  srj.obstacles[0]!.connectedTo = ["pcb_plated_hole_circle", "foreign_net"]
  // Radius=.5004. Nominal x half-width=.5 would wrongly skip this violation.
  const close = wire(
    "circle-near",
    "trace_net",
    [
      [0.6452, -2],
      [0.6452, 2],
    ],
    0.1,
  )
  expect(expectRectAabbParity(srj, [close]).errors.length).toBe(1)
  const far = wire(
    "circle-far",
    "trace_net",
    [
      [0.646, -2],
      [0.646, 2],
    ],
    0.1,
  )
  expect(expectRectAabbParity(srj, [far]).errors.length).toBe(0)
  expectRectAabbParity(srj, [
    close,
    via("same-circle-via", "other_net", 0.55, 0, "top", "bottom"),
  ])
})
