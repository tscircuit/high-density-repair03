import { test } from "bun:test"
import { expectClearanceDetour } from "./fixtures/expectClearanceDetour"

test("detours around plated holes across sizes, orientations and route order", (): void => {
  expectClearanceDetour("hole")
})
