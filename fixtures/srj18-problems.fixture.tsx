import {
  DrcProblemsFixture,
  type DrcProblemsFixtureSampleSource,
} from "../fixture-support/DrcProblemsFixture"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import type {
  GlobalDrcForceImproveSolverParams,
  HighDensityRoute,
  SimpleRouteJson,
} from "../lib"

type CapturedSolverOptions = Pick<
  GlobalDrcForceImproveSolverParams,
  | "effort"
  | "maxIterations"
  | "enableLargeBoardBroadFallback"
  | "enableTargetedErrorSweep"
  | "enablePostSolveClearanceRelaxation"
  | "enableViaInPadLayerMoves"
>

type StoredRepairFixture = {
  version: 1
  dataset: "srj18"
  sampleId: string
  params: CapturedSolverOptions & {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
}

const fixtureModules = import.meta.glob<{ default: StoredRepairFixture }>(
  "../benchmarks/srj18/*.json.gz",
)

const getSampleIdFromPath = (path: string): string => {
  const match = path.match(/\/(sample\d+)\.json\.gz$/)
  if (!match?.[1]) {
    throw new Error(`Invalid SRJ18 fixture path: ${path}`)
  }
  return match[1]
}

const sampleSources = Object.entries(fixtureModules)
  .map(([path, loadModule]) => ({
    id: getSampleIdFromPath(path),
    loadModule,
  }))
  .sort((left, right) => left.id.localeCompare(right.id))
  .map(
    ({ id, loadModule }): DrcProblemsFixtureSampleSource => ({
      id,
      load: async () => {
        const fixture = (await loadModule()).default
        const { srj, hdRoutes, ...solverOptions } = fixture.params
        return {
          id: fixture.sampleId,
          srj,
          hdRoutes,
          connMap: getConnectivityMapFromSimpleRouteJson(srj),
          solverOptions,
        }
      },
    }),
  )

export default function Srj18ProblemsFixture() {
  return (
    <DrcProblemsFixture
      datasetLabel="SRJ18"
      fixtureId="srj18"
      sampleSources={sampleSources}
    />
  )
}
