import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { createTerminalViaEscapeRepro } from "../fixture-support/terminalViaEscapeRepro"

test("snapshots the BGA via escape before and after stepped repair", () => {
  const { solver } = createTerminalViaEscapeRepro()
  solver.step()
  const before = solver.visualize()
  const beforeCount = solver.stats.remainingDrcIssueCount
  solver.solve()
  expect(solver.getOutput().remainingErrors).toHaveLength(0)
  const svg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally([before, solver.visualize()], {
      titles: [`Before: ${beforeCount} DRC errors`, "After: 0 DRC errors"],
    }),
    { backgroundColor: "white", svgWidth: 1400, svgHeight: 700 },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/terminal-via-escape.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, svg)
  }
  expect(svg).toBe(readFileSync(snapshotPath, "utf8"))
})
