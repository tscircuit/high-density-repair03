import { expect } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"

export const expectSnapshot = ({
  graphics,
  name,
  relaxedDrcCount,
}: {
  graphics: GraphicsObject
  name: string
  relaxedDrcCount?: number
}) => {
  let svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  if (relaxedDrcCount !== undefined) {
    const badge = `<g data-testid="relaxed-drc-summary"><rect x="12" y="12" width="330" height="62" rx="6" fill="white" stroke="#b91c1c"/><text x="24" y="39" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#b91c1c">Relaxed DRC errors: ${relaxedDrcCount}</text><text x="24" y="61" font-family="Arial, sans-serif" font-size="13" fill="#475569">repair03 stage · 0.1 mm clearances</text></g>`
    svg = svg.replace("</svg>", `${badge}</svg>`)
  }
  const path = new URL(`../../__snapshots__/${name}.snap.svg`, import.meta.url)
  if (process.env.BUN_UPDATE_SNAPSHOTS === "1") {
    mkdirSync(dirname(path.pathname), { recursive: true })
    writeFileSync(path, svg)
  }
  expect(svg).toBe(readFileSync(path, "utf8"))
}
