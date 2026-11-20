import { beforeAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import "bun-match-svg"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { GlobalDrcBranchPortfolioSolver, type HighDensityRoute } from "../lib"
import {
  getDrcSnapshot,
  hasNewTraceObstacleOverlaps,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getPhysicalSmtPadOverlaps } from "./fixtures/getPhysicalSmtPadOverlaps"
import { getExistingPadOverlapGraphics } from "./fixtures/getExistingPadOverlapGraphics"
import { getSavedCopperGraphics } from "./fixtures/getSavedCopperGraphics"
import provenance from "./fixtures/existing-pad-overlap-input.provenance.json"

type CapturedInput = Omit<
  ConstructorParameters<typeof GlobalDrcBranchPortfolioSolver>[0],
  "connMap"
> & {
  netMap: Record<string, string[]>
}
const input: CapturedInput = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("./fixtures/existing-pad-overlap-input.json.gz", import.meta.url),
    ),
  ).toString(),
)
let outputDrcCount: number
let output: HighDensityRoute[]
let outputPadOverlaps: ReturnType<typeof getPhysicalSmtPadOverlaps>

// Setup assertions must fail normally, not be hidden by test.failing.
beforeAll(() => {
  const connMap = new ConnectivityMap(input.netMap)
  const physicalSrj = structuredClone(input.srj)
  const pad = physicalSrj.obstacles.find(
    (obstacle) => obstacle.connectedTo[0] === provenance.physicalPad.obstacleId,
  )!
  expect(pad.width).toBe(provenance.routingObstacle.width)
  expect(pad.height).toBe(provenance.routingObstacle.height)
  physicalSrj.obstacles = [
    {
      ...pad,
      width: provenance.physicalPad.width,
      height: provenance.physicalPad.height,
    },
  ]
  expect(
    getPhysicalSmtPadOverlaps(physicalSrj, input.hdRoutes, connMap),
  ).toEqual([])
  const solver = new GlobalDrcBranchPortfolioSolver({
    ...structuredClone(input),
    connMap,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  output = solver.getOutput()
  expect(output).toHaveLength(input.hdRoutes.length)
  const before = getDrcSnapshot(
    input.srj,
    input.hdRoutes,
    undefined,
    connMap,
    solver.autoroutingDrcEngine,
  )
  const after = getDrcSnapshot(
    input.srj,
    output,
    undefined,
    connMap,
    solver.autoroutingDrcEngine,
  )
  outputDrcCount = after.count
  expect(
    before.errors.some((error) =>
      String(error.message).includes(provenance.physicalPad.obstacleId),
    ),
  ).toBe(true)
  // The existing pair passes this guard even when its physical overlap worsens.
  expect(hasNewTraceObstacleOverlaps(after, before)).toBe(false)
  outputPadOverlaps = getPhysicalSmtPadOverlaps(physicalSrj, output, connMap)
})

test.failing("repair does not turn an expanded-pad boundary violation into a physical pad short", () => {
  expect(outputPadOverlaps).toEqual([])
})

test("snapshots actual pad copper before and after repair", async () => {
  const graphics = stackGraphicsHorizontally(
    [
      getExistingPadOverlapGraphics(input.hdRoutes),
      getExistingPadOverlapGraphics(output),
    ],
    {
      titles: [
        "Before repair: copper is separate",
        `After repair: ${outputPadOverlaps.length} pad overlap(s)`,
      ],
    },
  )
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1200,
      svgHeight: 500,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

test("snapshots captured board routing after repair", async () => {
  const board = new VisualizedGlobalDrcForceImproveSolver({
    srj: input.srj,
    hdRoutes: output,
    connMap: new ConnectivityMap(input.netMap),
  }).visualize()
  // Replace display-only fixed-copper rectangles with verified saved geometry.
  // Keep the original SRJ, repair output, and DRC calculation unchanged.
  const displayCopper: HighDensityRoute[] = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/existing-pad-overlap-display-copper.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  board.rects = board.rects?.filter(
    (_, index) =>
      index === 0 ||
      !input.srj.obstacles[index - 1]?.connectedTo.some((id) =>
        id.startsWith("pcb_smtpad_fixed_"),
      ),
  )
  const copper = getSavedCopperGraphics(displayCopper)
  board.lines = [...(copper.lines ?? []), ...(board.lines ?? [])]
  board.circles = [...(copper.circles ?? []), ...(board.circles ?? [])]
  const graphics = stackGraphicsHorizontally([board], {
    titles: [
      `Fire-stick captured routing | DRC findings: ${outputDrcCount} | Target pad overlaps: ${outputPadOverlaps.length}`,
    ],
  })
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1200,
      svgHeight: 650,
    }),
  ).toMatchSvgSnapshot(import.meta.path, "board")
})
