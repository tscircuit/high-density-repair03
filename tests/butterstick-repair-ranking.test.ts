import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import "bun-match-svg"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import {
  getDrcMarkersForSolver,
  VisualizedGlobalDrcForceImproveSolver,
} from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import {
  getDrcSnapshot,
  getRepairDrcIssueCount,
  getRepairDrcIssueScore,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

type ButterstickRankingFixture = {
  srj: SimpleRouteJson & { minViaHoleEdgeToViaHoleEdgeClearance: number }
  hdRoutes: HighDensityRoute[]
  candidateRoute: HighDensityRoute
  netMap: Record<string, string[]>
}

// Native board: butterstick-fpga/butterstick-hardware, ButterStick_r1.0.
test("reproduces the ButterStick clearance ranking decision", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/butterstick-ranking-candidate.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as ButterstickRankingFixture
  const { srj, hdRoutes, candidateRoute } = fixture
  const connMap = new ConnectivityMap(fixture.netMap)
  const engine = new AutoroutingDrcEngine(srj, {
    connMap,
    traceClearance: srj.minTraceToPadEdgeClearance,
    viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
    viaToPadClearance: srj.minViaEdgeToPadEdgeClearance,
    includeTraceViaOwnerMetadata: true,
  })
  const candidateRoutes = hdRoutes.map(
    (route): HighDensityRoute =>
      route.connectionName === candidateRoute.connectionName
        ? candidateRoute
        : route,
  )
  const parent = getDrcSnapshot(srj, hdRoutes, undefined, connMap, engine)
  const candidate = getDrcSnapshot(
    srj,
    candidateRoutes,
    undefined,
    connMap,
    engine,
  )
  const parentScore = getRepairDrcIssueScore(parent)
  expect(parent.count).toBe(2)
  expect(candidate.count).toBe(parent.count)
  expect(getRepairDrcIssueScore(candidate)).toBeGreaterThan(parentScore)
  expect(getViaDrcIssueCount(candidate)).toBeLessThan(
    getViaDrcIssueCount(parent),
  )

  const acceptCandidate = isBetterDrcSnapshot(
    candidate,
    getViaDrcIssueCount(candidate),
    getRepairDrcIssueCount(parent),
    parentScore,
    getViaDrcIssueCount(parent),
    parent,
  )
  const selected = acceptCandidate ? candidate : parent
  expect(getRepairDrcIssueScore(selected)).toBeLessThanOrEqual(parentScore)
  const view = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes: acceptCandidate ? candidateRoutes : hdRoutes,
    connMap,
    autoroutingDrcEngine: engine,
    enableTraceViaOwnerTargeting: true,
    visibleLayer: "top",
  })
  view.setSelectedDrcMarkerId(
    getDrcMarkersForSolver(view).find((marker): boolean =>
      marker.message.includes("pcb_smtpad_66"),
    )?.id,
  )
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([view.visualize()], {
        titles: [
          `ButterStick top | DRC ${selected.count} | severity ${getRepairDrcIssueScore(selected).toFixed(3)}`,
        ],
      }),
      {
        backgroundColor: "white",
        includeTextLabels: false,
        hideInlineLabels: true,
        svgWidth: 1200,
        svgHeight: 900,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
