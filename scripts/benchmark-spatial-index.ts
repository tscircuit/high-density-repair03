import { readFileSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { gunzipSync } from "node:zlib"
import {
  type BuiltSpatialIndex,
  buildSpatialIndex,
  getNormalizedExactCandidates,
  type SpatialIndexAdapter,
  type SpatialIndexMode,
  verifySpatialIndexWorkload,
} from "./benchmarks/spatialIndexAdapters"
import {
  createSpatialIndexWorkloads,
  type SpatialIndexWorkload,
} from "./benchmarks/spatialIndexWorkloads"

type Summary = {
  medianMs: number
  minMs: number
  maxMs: number
  samplesMs: number[]
}
type Measurement = {
  adapter: SpatialIndexAdapter
  mode: SpatialIndexMode
  build: Summary
  query: Summary
  exact?: Summary
  queryRepetitions: number
  exactRepetitions?: number
  estimatedBuildPlusQueryBatchMs: number
  estimatedBuildPlusExactBatchMs?: number
  estimatedBuildPlusAllQueriesMs: number
  estimatedBuildPlusAllExactQueriesMs?: number
  queryReductionVsOriginalPercent?: number
  estimatedBuildPlusQueryReductionVsOriginalPercent?: number
  exactReductionVsOriginalPercent?: number
  estimatedBuildPlusExactReductionVsOriginalPercent?: number
}
type Task = {
  run: (repetitions: number) => void
  afterRun?: () => void
  repetitions: number
  samples: number[]
}
let consumedResults = 0
let lastBuiltIndex: BuiltSpatialIndex | undefined

const consume = (ids: number[]): void => {
  consumedResults = (consumedResults + ids.length + (ids[0] ?? 0)) >>> 0
}

const summarize = (values: number[]): Summary => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const medianMs =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!
  return {
    medianMs,
    minMs: sorted[0]!,
    maxMs: sorted.at(-1)!,
    samplesMs: values,
  }
}

const option = (name: string, defaultValue: string): string => {
  const args = process.argv.slice(2)
  const position = args.indexOf(name)
  if (position === -1) return defaultValue
  const value = args[position + 1]
  if (value === undefined) throw new Error(`Missing value for ${name}`)
  return value
}

const measure = (task: Task): number => {
  const started = performance.now()
  task.run(task.repetitions)
  const elapsed = performance.now() - started
  // Consume construction output after timing; construction includes no query.
  task.afterRun?.()
  return elapsed / task.repetitions
}

const calibrate = (task: Task, minTrialMs: number): void => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const elapsed = measure(task) * task.repetitions
    if (elapsed >= minTrialMs) return
    task.repetitions *= Math.max(
      2,
      Math.ceil(minTrialMs / Math.max(elapsed, 0.1)),
    )
  }
}

const getPackageVersion = (packageName: string): string => {
  const path = new URL(
    `../node_modules/${packageName}/package.json`,
    import.meta.url,
  )
  const metadata = JSON.parse(readFileSync(path, "utf8")) as { version: string }
  return metadata.version
}

const printSummary = (name: string, timings: Measurement[]): void => {
  console.log(`\n${name}: milliseconds per build and complete query batch`)
  console.log(
    "mode\tadapter\tbuild\tquery median [min,max]\texact query\test. build+batch\tquery reduction %",
  )
  for (const timing of timings) {
    console.log(
      [
        timing.mode,
        timing.adapter,
        timing.build.medianMs.toFixed(3),
        `${timing.query.medianMs.toFixed(3)} [${timing.query.minMs.toFixed(3)},${timing.query.maxMs.toFixed(3)}]`,
        timing.exact?.medianMs.toFixed(3) ?? "-",
        (
          timing.estimatedBuildPlusExactBatchMs ??
          timing.estimatedBuildPlusQueryBatchMs
        ).toFixed(3),
        (
          timing.exactReductionVsOriginalPercent ??
          timing.queryReductionVsOriginalPercent
        )?.toFixed(2),
      ].join("\t"),
    )
  }
}

export const runSpatialIndexBenchmark = async (): Promise<void> => {
  const trials = Number(option("--trials", "9"))
  const warmups = Number(option("--warmups", "3"))
  const minTrialMs = Number(option("--min-trial-ms", "30"))
  if (
    !Number.isInteger(trials) ||
    trials < 3 ||
    !Number.isInteger(warmups) ||
    warmups < 1 ||
    !Number.isFinite(minTrialMs) ||
    minTrialMs <= 0
  ) {
    throw new Error(
      "Use at least 3 trials, 1 warmup, and a positive finite minimum trial duration",
    )
  }
  const filter = option("--only", "")
  const tracePath = option("--trace", "")
  const workloads = createSpatialIndexWorkloads()
  if (tracePath) {
    const bytes = await Bun.file(tracePath).arrayBuffer()
    const text = tracePath.endsWith(".gz")
      ? gunzipSync(new Uint8Array(bytes)).toString()
      : new TextDecoder().decode(bytes)
    workloads.push(...(JSON.parse(text) as SpatialIndexWorkload[]))
  }
  const adapters: SpatialIndexAdapter[] = [
    "grid-set-sort",
    "grid-bitset",
    "flatbush",
    "rbush",
  ]
  const results = []
  for (const workload of workloads.filter((entry) =>
    entry.name.includes(filter),
  )) {
    const totalQueryCount = workload.totalQueryCount ?? workload.queries.length
    if (
      workload.queries.length === 0 ||
      !Number.isInteger(totalQueryCount) ||
      totalQueryCount < workload.queries.length
    ) {
      throw new Error(
        `${workload.name}: invalid query batch or total query count`,
      )
    }
    const parity = verifySpatialIndexWorkload(workload)
    const itemsById = new Map(workload.items.map((item) => [item.id, item]))
    const tasks: Task[] = []
    const measurements: Array<{
      adapter: SpatialIndexAdapter
      mode: SpatialIndexMode
      buildTask: Task
      queryTask: Task
      exactTask?: Task
    }> = []
    for (const mode of [
      "cell-candidates",
      "physical-exact",
    ] as SpatialIndexMode[]) {
      for (const adapter of adapters) {
        const index = buildSpatialIndex(adapter, workload, mode)
        const buildTask: Task = {
          repetitions: 1,
          samples: [],
          run(repetitions): void {
            for (let repeat = 0; repeat < repetitions; repeat++) {
              // Escape the complete constructed state, not just its query method.
              lastBuiltIndex = buildSpatialIndex(adapter, workload, mode)
            }
          },
          afterRun(): void {
            consume(lastBuiltIndex!.query(workload.queries[0]!))
          },
        }
        const queryTask: Task = {
          repetitions: 1,
          samples: [],
          run(repetitions): void {
            for (let repeat = 0; repeat < repetitions; repeat++) {
              for (const bounds of workload.queries) {
                consume(index.query(bounds))
              }
            }
          },
        }
        const exactTask: Task | undefined =
          mode === "physical-exact"
            ? {
                repetitions: 1,
                samples: [],
                run(repetitions): void {
                  for (let repeat = 0; repeat < repetitions; repeat++) {
                    for (const bounds of workload.queries) {
                      consume(
                        getNormalizedExactCandidates(index, itemsById, bounds),
                      )
                    }
                  }
                },
              }
            : undefined
        measurements.push({ adapter, mode, buildTask, queryTask, exactTask })
        tasks.push(buildTask, queryTask)
        if (exactTask) tasks.push(exactTask)
      }
    }
    for (const task of tasks) calibrate(task, minTrialMs)
    for (let round = 0; round < warmups + trials; round++) {
      // Rotate all build/query jobs so no implementation always runs first.
      for (let offset = 0; offset < tasks.length; offset++) {
        const task = tasks[(round + offset) % tasks.length]!
        const elapsed = measure(task)
        if (round >= warmups) task.samples.push(elapsed)
      }
    }
    const queryCountRatio = totalQueryCount / workload.queries.length
    const timings: Measurement[] = measurements.map((entry) => {
      const build = summarize(entry.buildTask.samples)
      const query = summarize(entry.queryTask.samples)
      const exact = entry.exactTask
        ? summarize(entry.exactTask.samples)
        : undefined
      return {
        adapter: entry.adapter,
        mode: entry.mode,
        build,
        query,
        exact,
        queryRepetitions: entry.queryTask.repetitions,
        exactRepetitions: entry.exactTask?.repetitions,
        estimatedBuildPlusQueryBatchMs: build.medianMs + query.medianMs,
        estimatedBuildPlusExactBatchMs: exact
          ? build.medianMs + exact.medianMs
          : undefined,
        estimatedBuildPlusAllQueriesMs:
          build.medianMs + query.medianMs * queryCountRatio,
        estimatedBuildPlusAllExactQueriesMs: exact
          ? build.medianMs + exact.medianMs * queryCountRatio
          : undefined,
      }
    })
    for (const timing of timings) {
      const original = timings.find(
        (entry) =>
          entry.mode === timing.mode && entry.adapter === "grid-set-sort",
      )!
      timing.queryReductionVsOriginalPercent =
        (1 - timing.query.medianMs / original.query.medianMs) * 100
      timing.estimatedBuildPlusQueryReductionVsOriginalPercent =
        (1 -
          timing.estimatedBuildPlusAllQueriesMs /
            original.estimatedBuildPlusAllQueriesMs) *
        100
      if (timing.exact && original.exact) {
        timing.exactReductionVsOriginalPercent =
          (1 - timing.exact.medianMs / original.exact.medianMs) * 100
        timing.estimatedBuildPlusExactReductionVsOriginalPercent =
          (1 -
            timing.estimatedBuildPlusAllExactQueriesMs! /
              original.estimatedBuildPlusAllExactQueriesMs!) *
          100
      }
    }
    results.push({
      name: workload.name,
      source: workload.source,
      items: workload.items.length,
      queries: workload.queries.length,
      cellSize: workload.cellSize,
      totalQueryCount,
      queryCountRatio,
      parity,
      timings,
    })
    printSummary(workload.name, timings)
  }
  if (results.length === 0) throw new Error(`No workloads match ${filter}`)
  const report = {
    runtime: Bun.version,
    cpu: cpus()[0]?.model,
    versions: {
      flatbush: getPackageVersion("flatbush"),
      rbush: getPackageVersion("rbush"),
    },
    trials,
    warmups,
    minTrialMs,
    semantics: {
      cellCandidates:
        "Same inclusive integer cell rectangles and ascending original IDs; no geometry filtering",
      physicalExact:
        "Native physical tree queries versus coarse grid queries, then identical AABB filter preserving ascending IDs",
      production:
        "Static snapshots; physical-exact mode is not a drop-in replacement for mutable repair-pass grid membership",
      estimates:
        "Build+batch totals sum separately measured medians, not end-to-end medians; all-query estimates scale sampled batch cost by totalQueryCount/queries.length",
    },
    consumedResults,
    results,
  }
  writeFileSync(
    option("--out", "/tmp/repair-spatial-benchmark.json"),
    JSON.stringify(report, null, 2) + "\n",
  )
}

if (import.meta.main) await runSpatialIndexBenchmark()
