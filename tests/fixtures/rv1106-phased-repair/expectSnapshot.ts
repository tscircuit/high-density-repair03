import { expect } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"

export const expectSnapshot = ({
  graphics,
  name,
}: {
  graphics: GraphicsObject
  name: string
}) => {
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const path = new URL(`../../__snapshots__/${name}.snap.svg`, import.meta.url)
  if (process.env.BUN_UPDATE_SNAPSHOTS === "1") {
    mkdirSync(dirname(path.pathname), { recursive: true })
    writeFileSync(path, svg)
  }
  expect(svg).toBe(readFileSync(path, "utf8"))
}
