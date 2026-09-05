import { expect, test } from "bun:test"
import { getViaLayers } from "../lib/utils/getViaLayers"

test("expands via endpoints across the complete inclusive layer span", () => {
  const layers = ["top", "inner1", "inner2", "bottom"]
  expect(getViaLayers({ from_layer: "top", to_layer: "bottom" }, 4)).toEqual(
    layers,
  )
  expect(getViaLayers({ from_layer: "bottom", to_layer: "top" }, 4)).toEqual(
    layers,
  )
  expect(getViaLayers({ from_layer: "inner3", to_layer: "inner1" }, 6)).toEqual(
    ["inner1", "inner2", "inner3"],
  )
  expect(getViaLayers({ from_layer: "inner1", to_layer: "inner1" }, 4)).toEqual(
    ["inner1"],
  )
  expect(() =>
    getViaLayers({ from_layer: "inner4", to_layer: "top" }, 4),
  ).toThrow("outside the board")
})
