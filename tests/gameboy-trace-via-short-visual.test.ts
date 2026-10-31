import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import {
  getGameBoyContactRepair,
  getGameBoyTraceViaContact,
} from "./fixtures/gameBoyContactRepair"

test("snapshots real Game Boy repair output and its trace-to-via contact", async () => {
  const { input, connMap, output } = getGameBoyContactRepair()
  const before = getGameBoyTraceViaContact(input.inputHdRoutes)
  const after = getGameBoyTraceViaContact(output)
  const board = new VisualizedGlobalDrcForceImproveSolver({
    srj: input.srj,
    hdRoutes: output,
    connMap,
  }).visualize()
  board.lines!.push({
    points: [...input.srj.outline, input.srj.outline[0]!],
    strokeWidth: 0.15,
    strokeColor: "#2563eb",
  })
  // Keep actual via copper; omit DRC marker disks that obscure the dense MCU.
  board.circles = board.circles!.filter((circle) =>
    circle.label?.endsWith(" via"),
  )
  board.circles.push({
    center: after.center,
    radius: 1.4,
    fill: "rgba(249, 115, 22, 0.2)",
    stroke: "#f97316",
    label: "Trace-to-via contact detail",
  })
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([board], {
        titles: [
          `Game Boy repair output | contact gap ${after.gap.toFixed(5)} mm`,
        ],
      }),
      { backgroundColor: "white", svgWidth: 1600, svgHeight: 1100 },
    ),
  ).toMatchSvgSnapshot(import.meta.path, "board")
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([before.graphics, after.graphics], {
        titles: [
          `Input gap: ${before.gap.toFixed(5)} mm`,
          `Published gap: ${after.gap.toFixed(5)} mm`,
        ],
      }),
      { backgroundColor: "white", svgWidth: 1400, svgHeight: 700 },
    ),
  ).toMatchSvgSnapshot(import.meta.path, "contact")
})
