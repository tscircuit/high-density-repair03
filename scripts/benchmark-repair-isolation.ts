import { mock } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GlobalDrcForceImproveSolver } from "../lib"

type RepairParams = ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0]
type CapturedParams = Omit<RepairParams, "connMap"> & {
  connMap: {
    netMap: ConnectivityMap["netMap"]
    idToNetMap: ConnectivityMap["idToNetMap"]
  }
}
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type SpatialTrace = {
  name: string
  cellSize: number
  items: Array<Bounds & { id: number; kind: "segment" | "via" | "obstacle" }>
  queries: Bounds[]
  source: string
  totalQueryCount: number
}
type Run = {
  variant: "baseline" | "optimized"
  warmup: boolean
  elapsedMs: number
  solved: boolean
  failed: boolean
  error: unknown
  iterations: number
  outputHash: string
  stats: unknown
  drc: { count: number; issueScore: number; errorsHash: string }
}

const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    optimized: { type: "string" },
    "baseline-ref": { type: "string" },
    "optimized-ref": { type: "string" },
    "connectivity-module": { type: "string" },
    fixture: { type: "string" },
    rounds: { type: "string", default: "3" },
    warmups: { type: "string", default: "1" },
    out: { type: "string", default: "repair-isolation-result.json" },
    "capture-spatial": { type: "string" },
    "check-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`Usage: bun scripts/benchmark-repair-isolation.ts
  --baseline /path/to/baseline/lib/index.ts
  --optimized /path/to/optimized/lib/index.ts
  [--baseline-ref SHA] [--optimized-ref SHA]
  [--connectivity-module /path/to/native-connectivity/dist/index.js]
  [--fixture capture.json[.gz]] [--rounds 3] [--warmups 1]
  [--out report.json] [--capture-spatial workloads.json.gz] [--check-only]

Runs sequentially in alternating order with fresh captured input and one native
ConnectivityMap implementation. Timings include solver construction and solve,
and exclude input/map setup and independent output validation. Spatial capture
uses an untimed optimized warmup; original exports are restored before timing.
Run without other CPU-heavy jobs. Do not interpret local timings as official
autorouter performance. All outcomes, routes, stats and DRC must match.`)
  process.exit(0)
}

if (!values.baseline || !values.optimized) {
  throw new Error("--baseline and --optimized module paths are required")
}
const rounds = Number(values.rounds)
const warmups = Number(values.warmups)
if (
  !Number.isInteger(rounds) ||
  rounds < 2 ||
  !Number.isInteger(warmups) ||
  warmups < 0
) {
  throw new Error(
    "Use at least two rounds and a non-negative integer warmup count",
  )
}
if (values["capture-spatial"] && warmups < 1) {
  throw new Error("Spatial capture requires at least one untimed warmup")
}

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href
const verifySource = (path: string, expected?: string) => {
  const cwd = dirname(resolve(path))
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd })
  if (result.exitCode !== 0)
    throw new Error(`No Git source revision for ${path}`)
  const commit = result.stdout.toString().trim()
  if (expected && commit !== expected) {
    throw new Error(
      `Source revision mismatch: ${commit} instead of ${expected}`,
    )
  }
  if (
    Bun.spawnSync(["git", "diff", "--quiet", "HEAD", "--", "."], { cwd })
      .exitCode !== 0
  ) {
    throw new Error(`Source has tracked modifications: ${path}`)
  }
  return { module: resolve(path), commit }
}
const sources = {
  baseline: verifySource(values.baseline, values["baseline-ref"]),
  optimized: verifySource(values.optimized, values["optimized-ref"]),
}
const nativeUrl = values["connectivity-module"]
  ? moduleUrl(values["connectivity-module"])
  : import.meta.resolve("circuit-json-to-connectivity-map")
const { ConnectivityMap: NativeConnectivityMap } = (await import(
  nativeUrl
)) as {
  ConnectivityMap: new (netMap: ConnectivityMap["netMap"]) => ConnectivityMap
}
if (NativeConnectivityMap.name !== "ConnectivityMap") {
  throw new Error(
    "Connectivity module must export the native ConnectivityMap class",
  )
}
const fixturePath = values.fixture
  ? resolve(values.fixture)
  : fileURLToPath(
      new URL(
        "../benchmarks/repair-isolation/srj18-pipeline9-sample004.json.gz",
        import.meta.url,
      ),
    )
const fixtureBytes = readFileSync(fixturePath)
const fixture = JSON.parse(
  (fixturePath.endsWith(".gz")
    ? gunzipSync(fixtureBytes)
    : fixtureBytes
  ).toString(),
)
const captured: CapturedParams = Array.isArray(fixture)
  ? fixture[0]
  : fixture.params
if (!captured?.connMap?.netMap || !captured.connMap.idToNetMap) {
  throw new Error("Capture must include both netMap and canonical idToNetMap")
}
const rehydrate = (): RepairParams => {
  const { connMap: storedMap, ...params } = structuredClone(captured)
  const connMap = new NativeConnectivityMap(storedMap.netMap)
  // Net aliases can share member lists. Their serialized order must not choose
  // new canonical names while replaying a captured map.
  connMap.idToNetMap = storedMap.idToNetMap
  for (const [id, net] of Object.entries(storedMap.idToNetMap)) {
    if (connMap.getNetConnectedToId(id) !== net) {
      throw new Error(`Connectivity rehydration changed ${id}`)
    }
  }
  return { ...params, connMap }
}
rehydrate()
const metadata = {
  sources,
  fixture: fixturePath,
  fixtureProvenance: fixture.provenance ?? null,
  inputHash: hash(captured),
  nativeConnectivityModule: fileURLToPath(nativeUrl),
  nativeConnectivitySourceHash: createHash("sha256")
    .update(readFileSync(fileURLToPath(nativeUrl)))
    .digest("hex"),
  rounds,
  warmups,
  settings: Object.fromEntries(
    Object.entries(captured).filter(
      ([key]) => !["srj", "hdRoutes", "connMap"].includes(key),
    ),
  ),
}
if (values["check-only"]) {
  console.log(JSON.stringify(metadata, null, 2))
  process.exit(0)
}

const baseline = await import(moduleUrl(values.baseline))
const optimized = await import(moduleUrl(values.optimized))
const referenceHelpers = await import(
  moduleUrl(
    resolve(
      dirname(values.baseline),
      "solvers/GlobalDrcForceImproveSolver/solverHelpers.ts",
    ),
  )
)
const spatialPath = resolve(
  dirname(values.optimized),
  "solvers/GlobalDrcForceImproveSolver/spatialIndex.ts",
)
const spatial = await import(moduleUrl(spatialPath))
const originalSpatial = { ...spatial }
const builds: Array<{
  kind: string
  itemCount: number
  cellSize: number
  queries: number
  trace?: SpatialTrace
}> = []
const capturedIndexes = new WeakMap<object, (typeof builds)[number]>()
const sampledKinds = new Map<string, number>()
const copyBounds = (bounds: Bounds): Bounds => ({
  minX: bounds.minX,
  minY: bounds.minY,
  maxX: bounds.maxX,
  maxY: bounds.maxY,
})
const installSpatialCapture = () => {
  mock.module(spatialPath, () => ({
    ...originalSpatial,
    createSpatialIndex: (
      items: unknown[],
      getBounds: (item: unknown) => Bounds,
      cellSize: number,
    ) => {
      const item = items.find(Boolean) as Record<string, unknown> | undefined
      const kind =
        item && "start" in item && "end" in item
          ? "segment"
          : item && "x" in item && "y" in item
            ? "via"
            : "obstacle"
      const entry: (typeof builds)[number] = {
        kind,
        itemCount: items.filter(Boolean).length,
        cellSize,
        queries: 0,
      }
      if (entry.itemCount > 0 && (sampledKinds.get(kind) ?? 0) < 2) {
        sampledKinds.set(kind, (sampledKinds.get(kind) ?? 0) + 1)
        entry.trace = {
          name: `${fixture.sampleId ?? "captured-repair"}-${kind}-build${builds.length}`,
          cellSize,
          items: items.flatMap((item, id) =>
            item ? [{ id, kind, ...copyBounds(getBounds(item)) }] : [],
          ) as SpatialTrace["items"],
          queries: [],
          source: `Actual optimized repair warmup: ${sources.optimized.commit}; input ${metadata.inputHash}`,
          totalQueryCount: 0,
        }
      }
      builds.push(entry)
      const index = originalSpatial.createSpatialIndex(
        items,
        getBounds,
        cellSize,
      )
      capturedIndexes.set(index, entry)
      return index
    },
    getSpatialCandidateIndexes: (
      index: object,
      bounds: Bounds,
      cellSize: number,
    ) => {
      const entry = capturedIndexes.get(index)
      if (!entry) throw new Error("Query uses an uncaptured spatial index")
      entry.queries++
      if (entry.trace) {
        entry.trace.queries.push(copyBounds(bounds))
        entry.trace.totalQueryCount++
      }
      return originalSpatial.getSpatialCandidateIndexes(index, bounds, cellSize)
    },
  }))
}
const spatialQueryCount = () =>
  builds.reduce((total, entry) => total + entry.queries, 0)
const runs: Run[] = []
let expectedParity: string | undefined
const execute = (variant: Run["variant"], warmup: boolean) => {
  const params = rehydrate()
  Bun.gc(true)
  const beforeQueries = spatialQueryCount()
  const started = performance.now()
  const solver: GlobalDrcForceImproveSolver = new (
    variant === "baseline" ? baseline : optimized
  ).GlobalDrcForceImproveSolver(params)
  solver.solve()
  const elapsedMs = performance.now() - started
  if (!warmup && spatialQueryCount() !== beforeQueries) {
    throw new Error(
      "Discard timings: spatial capture remained active during measurement",
    )
  }
  const output = solver.getOutput()
  const drc = referenceHelpers.getDrcSnapshot(
    params.srj,
    output,
    undefined,
    params.connMap,
  )
  const run: Run = {
    variant,
    warmup,
    elapsedMs,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    outputHash: hash(output),
    stats: structuredClone(solver.stats),
    drc: {
      count: drc.count,
      issueScore: drc.issueScore,
      errorsHash: hash(drc.errors),
    },
  }
  if (!run.solved || run.failed)
    throw new Error(`Repair failed: ${JSON.stringify(run)}`)
  const parity = hash({
    solved: run.solved,
    failed: run.failed,
    error: run.error,
    iterations: run.iterations,
    outputHash: run.outputHash,
    stats: run.stats,
    drc: run.drc,
  })
  expectedParity ??= parity
  if (parity !== expectedParity)
    throw new Error(
      `Outcome, geometry, statistics or DRC changed: ${JSON.stringify(run)}`,
    )
  runs.push(run)
  console.log(
    JSON.stringify({
      variant,
      warmup,
      elapsedMs,
      outputHash: run.outputHash,
      iterations: run.iterations,
      drc: run.drc,
    }),
  )
}

for (let round = 0; round < warmups; round++) {
  for (const variant of ["baseline", "optimized"] as const) {
    const capturePath =
      variant === "optimized" && round === 0
        ? values["capture-spatial"]
        : undefined
    if (capturePath) installSpatialCapture()
    execute(variant, true)
    if (capturePath) {
      mock.module(spatialPath, () => originalSpatial)
      if (
        spatial.createSpatialIndex !== originalSpatial.createSpatialIndex ||
        spatial.getSpatialCandidateIndexes !==
          originalSpatial.getSpatialCandidateIndexes
      ) {
        throw new Error("Failed to restore uninstrumented spatial exports")
      }
      const traces = builds.flatMap((entry) =>
        entry.trace ? [entry.trace] : [],
      )
      const json = Buffer.from(JSON.stringify(traces))
      writeFileSync(
        capturePath,
        capturePath.endsWith(".gz") ? gzipSync(json) : json,
      )
    }
  }
}
for (let round = 0; round < rounds; round++) {
  for (const variant of (round % 2 === 0
    ? ["baseline", "optimized"]
    : ["optimized", "baseline"]) as Run["variant"][])
    execute(variant, false)
}
const summarize = (variant: Run["variant"]) => {
  const times = runs
    .filter((run) => run.variant === variant && !run.warmup)
    .map((run) => run.elapsedMs)
    .sort((a, b) => a - b)
  const medianMs =
    times.length % 2
      ? times[Math.floor(times.length / 2)]!
      : (times[times.length / 2 - 1]! + times[times.length / 2]!) / 2
  return { medianMs, minMs: times[0]!, maxMs: times.at(-1)!, timesMs: times }
}
const summary = {
  baseline: summarize("baseline"),
  optimized: summarize("optimized"),
}
const report = {
  metadata,
  summary,
  medianReductionPct:
    100 * (1 - summary.optimized.medianMs / summary.baseline.medianMs),
  parityPassed: true,
  runs,
  spatialCapture: values["capture-spatial"]
    ? {
        file: resolve(values["capture-spatial"]),
        builds: builds.map(({ trace, ...entry }) => ({
          ...entry,
          capturedQueries: trace?.queries.length ?? 0,
        })),
        totalQueryCount: spatialQueryCount(),
      }
    : null,
}
writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify({
    ...summary,
    medianReductionPct: report.medianReductionPct,
    parityPassed: true,
    report: resolve(values.out),
  }),
)
