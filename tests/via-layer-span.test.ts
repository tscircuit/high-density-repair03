import { expect, test } from "bun:test"
import { getViaLayers } from "../lib/utils/getViaLayers"

test("matches Core's autorouted via-layer policy", () => {
  const layers = ["top", "inner1", "inner2", "bottom"]
  expect(getViaLayers({ layers }, 4)).toEqual(layers)
  expect(getViaLayers({ from_layer: "top", to_layer: "bottom" }, 4)).toEqual(
    layers,
  )
  expect(getViaLayers({ from_layer: "bottom", to_layer: "top" }, 4)).toEqual(
    layers,
  )
  expect(getViaLayers({ from_layer: "inner3", to_layer: "inner1" }, 6)).toEqual(
    ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
  )
  expect(getViaLayers({ from_layer: "inner1", to_layer: "inner1" }, 4)).toEqual(
    layers,
  )
  expect(
    getViaLayers({ from_layer: "inner3", to_layer: "inner1" }, 6, true),
  ).toEqual(["inner1", "inner2", "inner3"])
  expect(
    getViaLayers({ from_layer: "top", to_layer: "inner2" }, 4, true),
  ).toEqual(["top", "inner1", "inner2"])
  expect(
    getViaLayers(
      {
        layers: ["top", "inner1", "inner2"],
        from_layer: "top",
        to_layer: "inner2",
      },
      4,
      true,
    ),
  ).toEqual(["top", "inner1", "inner2"])
  expect(
    getViaLayers(
      {
        layers: ["top", "inner2"],
        from_layer: "top",
        to_layer: "inner2",
      },
      4,
      true,
    ),
  ).toEqual(["top", "inner1", "inner2"])
  expect(
    getViaLayers(
      {
        layers: ["top", "inner1", "inner2"],
        from_layer: "top",
        to_layer: "inner2",
      },
      4,
    ),
  ).toEqual(layers)
  expect(
    getViaLayers({ from_layer: "inner1", to_layer: "inner1" }, 4, true),
  ).toEqual(["inner1"])
  expect(() =>
    getViaLayers({ from_layer: "inner4", to_layer: "top" }, 4, true),
  ).toThrow("outside the board")
  expect(getViaLayers({ from_layer: "inner4", to_layer: "top" }, 4)).toEqual(
    layers,
  )
})
