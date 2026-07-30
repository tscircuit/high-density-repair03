import { readFileSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import drc14Samples from "dataset-drc14"
import type {
  HighDensityRoute,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../lib"
import { GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import type { SimpleRouteConnection } from "../types/srj-types"

type DatasetName = "drc14" | "srj18"

type Drc14DatasetSample = {
  id?: string
  simpleRouteJson?: SimpleRouteJson & { traces?: SimplifiedPcbTrace[] }
  metadata?: {
    relaxedDrcErrorCount?: number
    relaxedDrcPassed?: boolean
    sourceDataset?: string
    routingPipeline?: string
  }
}

type CapturedSolverOptions = {
  effort?: number
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
  enableTargetedErrorSweep?: boolean
  enablePostSolveClearanceRelaxation?: boolean
  enableViaInPadLayerMoves?: boolean
}

type StoredRepairFixture = {
  version: 1
  dataset: "srj18"
  sampleId: string
  scenarioName: string
  provenance: {
    repository: "tscircuit/tscircuit-autorouter"
    commit: string
    pipeline: string
    repairStage: string
  }
  params: CapturedSolverOptions & {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
}

type DatasetSample = Drc14DatasetSample | StoredRepairFixture

type SampleResult = {
  sampleId: string
  traceCount: number
  initialDrcCount: number
  finalDrcCount: number
  improvement: number
  iterations: number
  elapsedMs: number
  metadataRelaxedDrcErrorCount?: number
  error?: string
}

type IndexedSampleResult = SampleResult & { sampleIndex: number }

type WorkerInput = {
  dataset: DatasetName
  sampleIndex: number
  effort: number
  maxIterations?: number
}

type WorkerDoneMessage = {
  type: "done"
  sampleIndex: number
  result: SampleResult
}

type BenchmarkReport = {
  dataset: DatasetName
  sampleCount: number
  succeeded: number
  failed: number
  improved: number
  clean: number
  totalInitialDrcCount: number
  totalFinalDrcCount: number
  totalImprovement: number
  totalSolveTimeMs: number
  averageSolveTimeMs: number
  metadata: {
    effort: number
    maxIterations?: number
    concurrency: number
    scenarioLimitUsed: number
  }
  sampleResults: SampleResult[]
}

const DATASET_NAMES = ["drc14", "srj18"] as const
const SRJ18_SAMPLE_IDS = Array.from(
  { length: 16 },
  (_, index) => `sample${String(index + 1).padStart(3, "0")}`,
)

const formatMs = (ms: number) => `${ms.toFixed(2)}ms`

const printHelp = () => {
  console.log(`Usage:
  bun scripts/benchmark.ts [--dataset drc14|srj18] [--limit N|all] [--concurrency N] [--effort N] [--max-iterations N] [--out PATH] [--json] [--fail-on-drc]

Options:
  --dataset NAME        Dataset to benchmark: drc14 or srj18 (default: srj18)
  --limit N|all          Run first N samples, or all samples (default: all)
  --concurrency N        Number of Bun workers, or "auto"
  --effort N             Solver effort value (default: 1)
  --max-iterations N     Override solver max iterations
  --out PATH             Write JSON benchmark report (default: benchmark-result.json)
  --no-out               Do not write a JSON benchmark report
  --json                 Print the JSON report to stdout
  --fail-on-drc          Exit non-zero when any final DRC remains
  -h, --help             Show this help`)
}

const parseValueArg = (args: string[], flag: string) => {
  const equalsArg = args.find((arg) => arg.startsWith(`${flag}=`))
  if (equalsArg) return equalsArg.slice(flag.length + 1)

  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

const parseFirstValueArg = (args: string[], flags: string[]) => {
  for (const flag of flags) {
    const value = parseValueArg(args, flag)
    if (value !== undefined) return value
  }

  return undefined
}

const parseDatasetArg = (args: string[]): DatasetName => {
  const rawValue =
    parseValueArg(args, "--dataset") ?? Bun.env.BENCHMARK_DATASET ?? "srj18"
  const normalizedValue = rawValue.trim().toLowerCase()

  if (DATASET_NAMES.includes(normalizedValue as DatasetName)) {
    return normalizedValue as DatasetName
  }

  throw new Error(
    `Invalid value for --dataset: ${rawValue}. Expected drc14 or srj18.`,
  )
}

const parsePositiveNumberArg = (
  args: string[],
  flag: string,
  fallback: number,
) => {
  const rawValue = parseValueArg(args, flag)
  if (rawValue === undefined) return fallback

  const value = Number(rawValue)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${flag}: ${rawValue}`)
  }

  return value
}

const parseOptionalPositiveIntegerArg = (args: string[], flag: string) => {
  const rawValue = parseValueArg(args, flag)
  if (rawValue === undefined) return undefined

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${flag}: ${rawValue}`)
  }

  return value
}

const parseLimitArg = (args: string[], sampleCount: number) => {
  const rawValue = parseValueArg(args, "--limit")
  if (rawValue === undefined || rawValue.toLowerCase() === "all") {
    return sampleCount
  }

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for --limit: ${rawValue}`)
  }

  return Math.min(value, sampleCount)
}

const getDefaultConcurrency = () => {
  const rawValue = Bun.env.BENCHMARK_CONCURRENCY
  if (!rawValue) return Math.max(1, cpus().length)
  if (rawValue === "auto") return Math.max(1, cpus().length)

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid BENCHMARK_CONCURRENCY: ${rawValue}`)
  }

  return value
}

const parseConcurrencyArg = (args: string[]) => {
  const rawValue = parseFirstValueArg(args, [
    "--concurrency",
    "--concurrent",
    "--concurent",
    "--CONCURENT",
  ])
  if (rawValue === undefined) return getDefaultConcurrency()
  if (rawValue === "auto") return Math.max(1, cpus().length)

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for --concurrency: ${rawValue}`)
  }

  return value
}

const getLayerZ = (layer: string, layerCount: number) => {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(0, layerCount - 1)

  const innerLayerMatch = layer.match(/^inner(\d+)$/)
  if (innerLayerMatch) {
    const z = Number(innerLayerMatch[1])
    if (Number.isInteger(z) && z > 0 && z < layerCount - 1) return z
  }

  throw new Error(`Unsupported route layer: ${layer}`)
}

type CapturedConnection = SimpleRouteConnection & {
  __rootConnectionNames?: string[]
  __netConnectionName?: string
}

type CapturedTrace = SimplifiedPcbTrace & {
  connectsTo?: string[]
}

const pointHash = (point: { x: number; y: number }) =>
  `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`

const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson) => {
  const connMap = new ConnectivityMap({})

  for (const connection of srj.connections as CapturedConnection[]) {
    const connectionAliases = [
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([connectionAliases])

    for (const point of connection.pointsToConnect) {
      const pointLayers =
        "layers" in point
          ? point.layers
              .map((layer) => getLayerZ(layer, srj.layerCount))
              .sort()
              .join("-")
          : getLayerZ(point.layer, srj.layerCount)
      const pointAliases = [
        connection.name,
        `${pointHash(point)}:${pointLayers}`,
        point.pcb_port_id,
        point.pointId,
      ].filter((value): value is string => Boolean(value))
      connMap.addConnections([pointAliases])
    }
  }

  for (const obstacle of srj.obstacles) {
    const obstacleAliases = [
      obstacle.obstacleId,
      ...obstacle.connectedTo,
      ...(obstacle.offBoardConnectsTo ?? []),
      `${pointHash(obstacle.center)}:${obstacle.layers
        .map((layer) => getLayerZ(layer, srj.layerCount))
        .sort()
        .join("-")}`,
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([Array.from(new Set(obstacleAliases))])
  }

  for (const trace of (srj.traces ?? []) as CapturedTrace[]) {
    const traceAliases = [
      trace.pcb_trace_id,
      trace.connection_name,
      ...(trace.connectsTo ?? []),
    ].filter((value): value is string => Boolean(value))
    connMap.addConnections([Array.from(new Set(traceAliases))])
  }

  return connMap
}

const loadSrj18Sample = (sampleIndex: number): StoredRepairFixture => {
  const sampleId = SRJ18_SAMPLE_IDS[sampleIndex]
  if (!sampleId) {
    throw new Error(`Missing SRJ18 fixture at index ${sampleIndex}`)
  }

  const fixtureUrl = new URL(
    `../benchmarks/srj18/${sampleId}.json.gz`,
    import.meta.url,
  )
  return JSON.parse(
    gunzipSync(readFileSync(fixtureUrl)).toString("utf8"),
  ) as StoredRepairFixture
}

const loadDatasetSamples = (dataset: DatasetName): DatasetSample[] => {
  if (dataset === "drc14") {
    return drc14Samples as Drc14DatasetSample[]
  }

  return SRJ18_SAMPLE_IDS.map((_, sampleIndex) => loadSrj18Sample(sampleIndex))
}

const loadDatasetSample = (
  dataset: DatasetName,
  sampleIndex: number,
): DatasetSample | undefined => {
  if (dataset === "drc14") {
    return (drc14Samples as Drc14DatasetSample[])[sampleIndex]
  }

  return sampleIndex < SRJ18_SAMPLE_IDS.length
    ? loadSrj18Sample(sampleIndex)
    : undefined
}

const pushRoutePoint = (
  route: HighDensityRoute["route"],
  point: HighDensityRoute["route"][number],
) => {
  const lastPoint = route[route.length - 1]
  if (
    lastPoint &&
    lastPoint.x === point.x &&
    lastPoint.y === point.y &&
    lastPoint.z === point.z
  ) {
    return
  }
  route.push(point)
}

const getConnectionNameForTrace = (
  trace: SimplifiedPcbTrace,
  connections: SimpleRouteConnection[],
) => {
  const matchingConnection = connections
    .filter((connection) =>
      trace.pcb_trace_id.startsWith(`${connection.name}_`),
    )
    .sort((a, b) => b.name.length - a.name.length)[0]

  return matchingConnection?.name ?? trace.connection_name
}

const traceToHdRoute = (
  trace: SimplifiedPcbTrace,
  srj: SimpleRouteJson,
): HighDensityRoute => {
  const route: HighDensityRoute["route"] = []
  const vias: HighDensityRoute["vias"] = []
  let traceThickness = srj.minTraceWidth
  let viaDiameter = srj.minViaDiameter ?? 0.3

  for (const segment of trace.route) {
    if (segment.route_type === "wire") {
      traceThickness = segment.width
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.layer, srj.layerCount),
        ...(segment.start_pcb_port_id
          ? { pcb_port_id: segment.start_pcb_port_id }
          : {}),
        ...(segment.end_pcb_port_id
          ? { pcb_port_id: segment.end_pcb_port_id }
          : {}),
      })
      continue
    }

    if (segment.route_type === "via") {
      viaDiameter = segment.via_diameter ?? viaDiameter
      vias.push({ x: segment.x, y: segment.y })
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.from_layer, srj.layerCount),
      })
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.to_layer, srj.layerCount),
      })
      continue
    }

    pushRoutePoint(route, {
      x: segment.start.x,
      y: segment.start.y,
      z: getLayerZ(segment.layer, srj.layerCount),
    })
    pushRoutePoint(route, {
      x: segment.end.x,
      y: segment.end.y,
      z: getLayerZ(segment.layer, srj.layerCount),
    })
  }

  return {
    connectionName: getConnectionNameForTrace(trace, srj.connections),
    rootConnectionName: trace.connection_name,
    traceThickness,
    viaDiameter,
    route,
    vias,
  }
}

const isStoredRepairFixture = (
  sample: DatasetSample,
): sample is StoredRepairFixture => "params" in sample

const getSampleId = (sample: DatasetSample) =>
  isStoredRepairFixture(sample) ? sample.sampleId : (sample.id ?? "unknown")

const sampleToHdRoutes = (sample: Drc14DatasetSample) => {
  const srj = sample.simpleRouteJson
  if (!srj) {
    throw new Error("Sample is missing simpleRouteJson")
  }
  if (!srj.traces || srj.traces.length === 0) {
    throw new Error("Sample simpleRouteJson is missing traces")
  }

  return {
    srj,
    hdRoutes: srj.traces.map((trace) => traceToHdRoute(trace, srj)),
  }
}

const sampleToRepairInput = (sample: DatasetSample) => {
  if (isStoredRepairFixture(sample)) {
    const { srj, hdRoutes, ...capturedOptions } = sample.params
    return { srj, hdRoutes, capturedOptions }
  }

  return {
    ...sampleToHdRoutes(sample),
    capturedOptions: {} satisfies CapturedSolverOptions,
  }
}

const runSample = ({
  sample,
  effort,
  maxIterations,
}: {
  sample: DatasetSample
  effort: number
  maxIterations?: number
}): SampleResult => {
  const sampleId = getSampleId(sample)
  const startedAt = performance.now()

  try {
    const { srj, hdRoutes, capturedOptions } = sampleToRepairInput(sample)
    const {
      effort: _capturedEffort,
      maxIterations: capturedMaxIterations,
      ...capturedBooleanOptions
    } = capturedOptions
    const effectiveMaxIterations = maxIterations ?? capturedMaxIterations
    const initialDrc = getDrcSnapshot(srj, hdRoutes)
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes,
      ...(isStoredRepairFixture(sample)
        ? {
            connMap: getConnectivityMapFromSimpleRouteJson(srj),
            ...capturedBooleanOptions,
          }
        : {}),
      effort,
      ...(effectiveMaxIterations !== undefined
        ? { maxIterations: effectiveMaxIterations }
        : {}),
    })

    solver.solve()

    const outputRoutes = solver.getOutput()
    const finalDrc = getDrcSnapshot(srj, outputRoutes)
    const elapsedMs = performance.now() - startedAt

    return {
      sampleId,
      traceCount: hdRoutes.length,
      initialDrcCount: initialDrc.count,
      finalDrcCount: finalDrc.count,
      improvement: initialDrc.count - finalDrc.count,
      iterations: solver.iterations,
      elapsedMs,
      metadataRelaxedDrcErrorCount: isStoredRepairFixture(sample)
        ? undefined
        : sample.metadata?.relaxedDrcErrorCount,
    }
  } catch (error) {
    return {
      sampleId,
      traceCount: 0,
      initialDrcCount: 0,
      finalDrcCount: 0,
      improvement: 0,
      iterations: 0,
      elapsedMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const buildReport = ({
  dataset,
  results,
  effort,
  maxIterations,
  concurrency,
  scenarioLimitUsed,
}: {
  dataset: DatasetName
  results: SampleResult[]
  effort: number
  maxIterations?: number
  concurrency: number
  scenarioLimitUsed: number
}): BenchmarkReport => {
  const succeeded = results.filter((result) => !result.error)
  const totalSolveTimeMs = results.reduce(
    (sum, result) => sum + result.elapsedMs,
    0,
  )
  const totalInitialDrcCount = succeeded.reduce(
    (sum, result) => sum + result.initialDrcCount,
    0,
  )
  const totalFinalDrcCount = succeeded.reduce(
    (sum, result) => sum + result.finalDrcCount,
    0,
  )

  return {
    dataset,
    sampleCount: results.length,
    succeeded: succeeded.length,
    failed: results.length - succeeded.length,
    improved: succeeded.filter((result) => result.improvement > 0).length,
    clean: succeeded.filter((result) => result.finalDrcCount === 0).length,
    totalInitialDrcCount,
    totalFinalDrcCount,
    totalImprovement: totalInitialDrcCount - totalFinalDrcCount,
    totalSolveTimeMs,
    averageSolveTimeMs:
      results.length > 0 ? totalSolveTimeMs / results.length : 0,
    metadata: {
      effort,
      ...(maxIterations !== undefined ? { maxIterations } : {}),
      concurrency,
      scenarioLimitUsed,
    },
    sampleResults: results,
  }
}

const logSummary = (report: BenchmarkReport) => {
  const rows: Array<[string, string]> = [
    ["Samples", String(report.sampleCount)],
    ["Succeeded", String(report.succeeded)],
    ["Failed", String(report.failed)],
    ["Improved", String(report.improved)],
    ["Clean", String(report.clean)],
    ["Initial DRC", String(report.totalInitialDrcCount)],
    ["Final DRC", String(report.totalFinalDrcCount)],
    ["DRC improvement", String(report.totalImprovement)],
    ["Total solve time", formatMs(report.totalSolveTimeMs)],
    ["Average solve time", formatMs(report.averageSolveTimeMs)],
  ]
  const metricHeader = "Metric"
  const valueHeader = "Value"
  const metricWidth = Math.max(
    metricHeader.length,
    ...rows.map(([metric]) => metric.length),
  )
  const valueWidth = Math.max(
    valueHeader.length,
    ...rows.map(([, value]) => value.length),
  )
  const horizontal = `+${"-".repeat(metricWidth + 2)}+${"-".repeat(valueWidth + 2)}+`
  const renderRow = (metric: string, value: string) =>
    `| ${metric.padEnd(metricWidth)} | ${value.padStart(valueWidth)} |`

  console.log("")
  console.log(`Dataset ${report.dataset.toUpperCase()} benchmark summary`)
  console.log(horizontal)
  console.log(renderRow(metricHeader, valueHeader))
  console.log(horizontal)
  for (const [metric, value] of rows) {
    console.log(renderRow(metric, value))
  }
  console.log(horizontal)
}

const logSamplesWithRemainingDrc = (report: BenchmarkReport) => {
  const remainingDrcSamples = report.sampleResults
    .map((result, index) => ({ ...result, sampleNumber: index + 1 }))
    .filter((result) => !result.error && result.finalDrcCount > 0)

  console.log("")
  if (remainingDrcSamples.length === 0) {
    console.log("Samples with remaining DRC: none")
    return
  }

  const headers = [
    "Sample",
    "ID",
    "Initial DRC",
    "Final DRC",
    "Iterations",
    "Time",
  ]
  const rows = remainingDrcSamples.map((result) => [
    String(result.sampleNumber),
    result.sampleId,
    String(result.initialDrcCount),
    String(result.finalDrcCount),
    String(result.iterations),
    formatMs(result.elapsedMs),
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  )
  const horizontal = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const renderRow = (row: string[]) =>
    `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`

  console.log("Samples with remaining DRC")
  console.log(horizontal)
  console.log(renderRow(headers))
  console.log(horizontal)
  for (const row of rows) {
    console.log(renderRow(row))
  }
  console.log(horizontal)
}

const logSampleResult = (
  result: SampleResult,
  sampleNumber: number,
  sampleCount: number,
) => {
  const status = result.error
    ? `error=${result.error}`
    : `drc=${result.initialDrcCount}->${result.finalDrcCount} iterations=${result.iterations}`
  console.log(
    `[sample] ${sampleNumber}/${sampleCount} ${result.sampleId} traces=${result.traceCount} ${status} time=${formatMs(result.elapsedMs)}`,
  )
}

const runSamples = async ({
  dataset,
  selectedSamples,
  effort,
  maxIterations,
  concurrency,
}: {
  dataset: DatasetName
  selectedSamples: DatasetSample[]
  effort: number
  maxIterations?: number
  concurrency: number
}) => {
  const results: IndexedSampleResult[] = []
  let nextIndex = 0
  let activeWorkers = 0

  return await new Promise<SampleResult[]>((resolve) => {
    const finishIfDone = () => {
      if (
        nextIndex >= selectedSamples.length &&
        activeWorkers === 0 &&
        results.length === selectedSamples.length
      ) {
        resolve(
          results
            .sort((a, b) => a.sampleIndex - b.sampleIndex)
            .map(({ sampleIndex: _sampleIndex, ...result }) => result),
        )
      }
    }

    const launchNextWorker = () => {
      while (
        activeWorkers < concurrency &&
        nextIndex < selectedSamples.length
      ) {
        const sampleIndex = nextIndex
        nextIndex += 1
        activeWorkers += 1
        let hasResult = false

        const worker = new Worker(new URL(import.meta.url), {
          workerData: {
            dataset,
            sampleIndex,
            effort,
            ...(maxIterations !== undefined ? { maxIterations } : {}),
          } satisfies WorkerInput,
        })

        worker.on("message", (message: WorkerDoneMessage) => {
          if (message.type !== "done") return
          hasResult = true

          const sampleNumber = message.sampleIndex + 1
          logSampleResult(message.result, sampleNumber, selectedSamples.length)
          results.push({
            ...message.result,
            sampleIndex: message.sampleIndex,
          })
        })

        worker.on("error", (error) => {
          hasResult = true
          const sample = selectedSamples[sampleIndex]
          const result: SampleResult = {
            sampleId: sample ? getSampleId(sample) : `sample${sampleIndex + 1}`,
            traceCount: 0,
            initialDrcCount: 0,
            finalDrcCount: 0,
            improvement: 0,
            iterations: 0,
            elapsedMs: 0,
            error: error instanceof Error ? error.message : String(error),
          }
          logSampleResult(result, sampleIndex + 1, selectedSamples.length)
          results.push({ ...result, sampleIndex })
        })

        worker.on("exit", () => {
          if (!hasResult) {
            const sample = selectedSamples[sampleIndex]
            const result: SampleResult = {
              sampleId: sample
                ? getSampleId(sample)
                : `sample${sampleIndex + 1}`,
              traceCount: 0,
              initialDrcCount: 0,
              finalDrcCount: 0,
              improvement: 0,
              iterations: 0,
              elapsedMs: 0,
              error: "Worker exited before returning a result",
            }
            logSampleResult(result, sampleIndex + 1, selectedSamples.length)
            results.push({ ...result, sampleIndex })
          }
          activeWorkers -= 1
          launchNextWorker()
          finishIfDone()
        })
      }

      finishIfDone()
    }

    launchNextWorker()
  })
}

const runWorker = () => {
  const { dataset, sampleIndex, effort, maxIterations } =
    workerData as WorkerInput
  const sample = loadDatasetSample(dataset, sampleIndex)

  const result = sample
    ? runSample({ sample, effort, maxIterations })
    : ({
        sampleId: `sample${sampleIndex + 1}`,
        traceCount: 0,
        initialDrcCount: 0,
        finalDrcCount: 0,
        improvement: 0,
        iterations: 0,
        elapsedMs: 0,
        error: `Missing dataset sample at index ${sampleIndex}`,
      } satisfies SampleResult)

  parentPort?.postMessage({
    type: "done",
    sampleIndex,
    result,
  } satisfies WorkerDoneMessage)
}

export const runBenchmark = async (args: string[] = Bun.argv.slice(2)) => {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp()
    return
  }

  const dataset = parseDatasetArg(args)
  const datasetSamples = loadDatasetSamples(dataset)
  const limit = parseLimitArg(args, datasetSamples.length)
  const effort = parsePositiveNumberArg(args, "--effort", 1)
  const concurrency = parseConcurrencyArg(args)
  const maxIterationsOverride = parseOptionalPositiveIntegerArg(
    args,
    "--max-iterations",
  )
  const outputPath = parseValueArg(args, "--out") ?? "benchmark-result.json"
  const shouldWriteOutput = !args.includes("--no-out")
  const shouldPrintJson = args.includes("--json")
  const shouldFailOnDrc = args.includes("--fail-on-drc")

  const selectedSamples = datasetSamples.slice(0, limit)
  const firstSample = selectedSamples[0]
  const capturedMaxIterations =
    firstSample && isStoredRepairFixture(firstSample)
      ? firstSample.params.maxIterations
      : undefined
  const maxIterations = maxIterationsOverride ?? capturedMaxIterations
  const effectiveConcurrency = Math.min(
    concurrency,
    Math.max(1, selectedSamples.length),
  )
  console.log(
    `Starting ${dataset.toUpperCase()} benchmark: samples=${selectedSamples.length} workers=${effectiveConcurrency} effort=${effort}` +
      (maxIterations !== undefined ? ` maxIterations=${maxIterations}` : ""),
  )

  const results = await runSamples({
    dataset,
    selectedSamples,
    effort,
    maxIterations,
    concurrency: effectiveConcurrency,
  })

  const report = buildReport({
    dataset,
    results,
    effort,
    maxIterations,
    concurrency: effectiveConcurrency,
    scenarioLimitUsed: selectedSamples.length,
  })

  logSummary(report)
  logSamplesWithRemainingDrc(report)

  if (shouldWriteOutput) {
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Wrote benchmark report to ${outputPath}`)
  }

  if (shouldPrintJson) {
    console.log(JSON.stringify(report, null, 2))
  }

  if (report.failed > 0 || (shouldFailOnDrc && report.totalFinalDrcCount > 0)) {
    process.exitCode = 1
  }
}

if (import.meta.main && isMainThread) {
  await runBenchmark()
} else if (!isMainThread) {
  runWorker()
}
