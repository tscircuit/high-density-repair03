import { mock } from "bun:test"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import {
  buildSpatialIndex,
  type BuiltSpatialIndex,
} from "./benchmarks/spatialIndexAdapters"
import type {
  SpatialIndexBounds,
  SpatialIndexItem,
} from "./benchmarks/spatialIndexWorkloads"

type Backend = "flatbush" | "rbush"
type Injection = {
  backend: Backend
  spatialModule: string
  counterFile: string
}
const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href

// The same file serves as a Bun preload in the measurement subprocess. Only
// the tree worktree is mocked; the baseline retains native optimized bitsets.
const injectionJson = process.env.REPAIR_SPATIAL_BENCHMARK_INJECTION
if (injectionJson) {
  const injection: Injection = JSON.parse(injectionJson)
  const spatial = await import(moduleUrl(injection.spatialModule))
  const original = { ...spatial }
  const indexes = new WeakMap<
    object,
    {
      tree: BuiltSpatialIndex
      cellSize: number
    }
  >()
  let buildCount = 0
  let queryCount = 0
  const createSpatialIndex = (
    items: unknown[],
    getBounds: (item: unknown) => SpatialIndexBounds,
    cellSize: number,
  ) => {
    const snapshot: SpatialIndexItem[] = []
    for (let id = 0; id < items.length; id++) {
      const item = items[id]
      if (!item) continue
      const bounds = getBounds(item)
      snapshot.push({
        id,
        kind: "segment",
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      })
    }
    const tree = buildSpatialIndex(
      injection.backend,
      {
        name: "full-repair-index",
        cellSize,
        items: snapshot,
        queries: [],
        source: "Benchmark-only full-repair backend injection",
      },
      "cell-candidates",
    )
    // Solver helpers treat the index as an opaque token and use only the query
    // export. A Map token preserves the original public return type.
    const token = new Map<string, number[]>()
    indexes.set(token, { tree, cellSize })
    buildCount++
    return token
  }
  const getSpatialCandidateIndexes = (
    token: object,
    bounds: SpatialIndexBounds,
    cellSize: number,
  ) => {
    const index = indexes.get(token)
    if (!index || index.cellSize !== cellSize) {
      throw new Error("Tree query uses an unknown index or changed cell size")
    }
    queryCount++
    return index.tree.query(bounds)
  }
  mock.module(injection.spatialModule, () => ({
    ...original,
    createSpatialIndex,
    getSpatialCandidateIndexes,
  }))
  if (
    spatial.createSpatialIndex !== createSpatialIndex ||
    spatial.getSpatialCandidateIndexes !== getSpatialCandidateIndexes
  ) {
    throw new Error("Failed to install tree spatial exports")
  }
  process.on("exit", () => {
    writeFileSync(
      injection.counterFile,
      JSON.stringify({
        backend: injection.backend,
        buildCount,
        queryCount,
      }),
    )
  })
} else {
  const { values } = parseArgs({
    options: {
      backend: { type: "string" },
      baseline: { type: "string" },
      optimized: { type: "string" },
      "baseline-ref": { type: "string" },
      "optimized-ref": { type: "string" },
      "connectivity-module": { type: "string" },
      fixture: { type: "string" },
      rounds: { type: "string", default: "3" },
      warmups: { type: "string", default: "1" },
      out: { type: "string" },
      "check-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (values.help) {
    console.log(`Usage: bun scripts/benchmark-repair-spatial-backends.ts
  --backend flatbush|rbush
  --baseline /path/to/grid-worktree/lib/index.ts
  --optimized /path/to/separate-same-revision-worktree/lib/index.ts
  [--baseline-ref SHA] [--optimized-ref SHA]
  [--connectivity-module /path/to/native-connectivity/dist/index.js]
  [--fixture capture.json[.gz]] [--rounds 3] [--warmups 1]
  [--out report.json] [--check-only]

Compare optimized native grid-bitsets against a tree backend in a separate
worktree at the same revision. Reuses the full-repair isolation runner and its
native ConnectivityMap, input restoration, alternating order and exact outcome
checks. The tree indexes inclusive integer cell ranges and returns sorted
original item IDs. Index rebuild boundaries stay unchanged. Snapshot/adapter
conversion and tree-call counters are included in tree timing. The adapter
replaces exports only in the benchmark subprocess; source files stay unchanged.
Run without other CPU-heavy jobs.`)
    process.exit(0)
  }
  if (
    !values.baseline ||
    !values.optimized ||
    !["flatbush", "rbush"].includes(values.backend ?? "")
  ) {
    throw new Error(
      "--backend flatbush|rbush, --baseline and --optimized are required",
    )
  }
  if (realpathSync(values.baseline) === realpathSync(values.optimized)) {
    throw new Error("Use distinct worktrees so only the tree variant is mocked")
  }
  const spatialModulePath = (entrypoint: string): string =>
    resolve(
      dirname(entrypoint),
      "solvers/GlobalDrcForceImproveSolver/spatialIndex.ts",
    )
  if (
    realpathSync(spatialModulePath(values.baseline)) ===
    realpathSync(spatialModulePath(values.optimized))
  ) {
    throw new Error(
      "Grid and tree entrypoints must use distinct spatial modules",
    )
  }
  const getRef = (path: string) => {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: dirname(resolve(path)),
    })
    if (result.exitCode !== 0) throw new Error(`No source revision for ${path}`)
    return result.stdout.toString().trim()
  }
  const baselineRef = getRef(values.baseline)
  const optimizedRef = getRef(values.optimized)
  if (baselineRef !== optimizedRef) {
    throw new Error("Backend comparison requires identical source revisions")
  }
  const backend = values.backend as Backend
  const out = resolve(values.out ?? `repair-spatial-${backend}-result.json`)
  const counterFile = `${out}.backend-counters.json`
  const injection: Injection = {
    backend,
    spatialModule: spatialModulePath(values.optimized),
    counterFile,
  }
  const runner = fileURLToPath(
    new URL("benchmark-repair-isolation.ts", import.meta.url),
  )
  const args = [
    process.execPath,
    "--preload",
    fileURLToPath(import.meta.url),
    runner,
    "--baseline",
    resolve(values.baseline),
    "--optimized",
    resolve(values.optimized),
    "--baseline-ref",
    values["baseline-ref"] ?? baselineRef,
    "--optimized-ref",
    values["optimized-ref"] ?? optimizedRef,
    "--rounds",
    values.rounds,
    "--warmups",
    values.warmups,
    "--out",
    out,
  ]
  for (const key of ["connectivity-module", "fixture"] as const) {
    if (values[key]) args.push(`--${key}`, resolve(values[key]))
  }
  if (values["check-only"]) args.push("--check-only")
  const child = Bun.spawn(args, {
    env: {
      ...process.env,
      REPAIR_SPATIAL_BENCHMARK_INJECTION: JSON.stringify(injection),
    },
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0)
    throw new Error(`Repair backend comparison failed (${exitCode})`)
  if (!values["check-only"]) {
    const counters = JSON.parse(readFileSync(counterFile, "utf8"))
    if (counters.buildCount === 0 || counters.queryCount === 0) {
      throw new Error("Discard timings: tree backend was not exercised")
    }
    const report = JSON.parse(readFileSync(out, "utf8"))
    report.spatialBackendComparison = {
      baseline: "native-optimized-grid-bitset",
      optimized: backend,
      mode: "cell-candidates",
      adapterConversionOverheadIncluded: true,
      queryCountersIncludedInTiming: true,
      ...counters,
    }
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
    console.log(
      JSON.stringify({
        gridMedianMs: report.summary.baseline.medianMs,
        treeMedianMs: report.summary.optimized.medianMs,
        treeReductionPct: report.medianReductionPct,
        counters,
        report: out,
      }),
    )
  }
}
