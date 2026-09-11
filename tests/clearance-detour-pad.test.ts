import { test } from "bun:test"
import { expectClearanceDetour } from "./fixtures/expectClearanceDetour"

test("detours around pad extents across sizes, orientations and route order", (): void => {
  expectClearanceDetour("pad")
})
