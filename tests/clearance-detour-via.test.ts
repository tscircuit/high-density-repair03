import { test } from "bun:test"
import { expectClearanceDetour } from "./fixtures/expectClearanceDetour"

test("detours around vias across sizes, orientations and route order", (): void => {
  expectClearanceDetour("via")
})
