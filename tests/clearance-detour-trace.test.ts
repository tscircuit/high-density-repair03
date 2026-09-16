import { test } from "bun:test"
import { expectClearanceDetour } from "./fixtures/expectClearanceDetour"

test("detours around crossing traces across sizes, orientations and route order", (): void => {
  expectClearanceDetour("trace")
})
