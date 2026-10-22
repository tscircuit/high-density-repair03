# Isolated full-repair replay

`srj18-pipeline9-sample004.json.gz` is the serialized constructor input for the
autorouter's `globalDrcForceImproveSolver` stage on SRJ18 sample004, using
`AutoroutingPipelineSolver9_PreloadedTraceGraph`. It includes 114 routes and the
captured connectivity map. This is an input to a repair stage, not a complete
autorouter benchmark. The original capture did not record its source revision;
the fixture records its original file hash and the harness records its input
hash. It is distinct from the older Pipeline7 fixture in `benchmarks/srj18`.

The harness creates a fresh native `ConnectivityMap` for every run and restores
the captured `idToNetMap`, so net aliases retain their canonical names. Both
variants receive the same implementation, input and settings. No indexed or
fused connectivity implementation is installed. The baseline and optimized
module paths must be Git worktrees with clean, tracked library sources; optional
reference arguments enforce exact revisions. Use the same installed runtime
dependencies for both worktrees.

For the original comparison, the baseline was
`ccad3906eb0fe30c9f79f4e28f390d9f41cbf387` and the optimized version was
`aee0ef270ea31bf149ba5b463857d3aac48c02d1`. Both worktrees shared one
`node_modules` directory, and the explicit native connectivity module was
version 0.0.19 from the autorouter installation. To reproduce that comparison,
create detached worktrees for these revisions and run:

```sh
bun scripts/benchmark-repair-isolation.ts \
  --baseline /path/to/ccad-worktree/lib/index.ts \
  --optimized /path/to/aee-worktree/lib/index.ts \
  --baseline-ref ccad3906eb0fe30c9f79f4e28f390d9f41cbf387 \
  --optimized-ref aee0ef270ea31bf149ba5b463857d3aac48c02d1 \
  --connectivity-module /path/to/native-connectivity/dist/index.js \
  --rounds 3 --warmups 1 \
  --capture-spatial fixtures/repair-spatial-query-trace.json.gz \
  --out repair-isolation-result.json
```

Run `--check-only` first to check the revisions, fixture and native connectivity
source hash without solving. `--help` lists all options. If
`--connectivity-module` is omitted, the harness uses its own installed native
connectivity package; this is a valid comparison but may produce different
absolute timings from version 0.0.19. Avoid other CPU-heavy jobs while measuring.

One untimed warmup per variant precedes three alternating, sequential measured
runs (`baseline, optimized`; `optimized, baseline`; `baseline, optimized`). The
timer includes solver construction and solving. Input cloning, map rebuilding,
explicit garbage collection and independent DRC validation are outside it. The
report includes every elapsed time, medians, ranges and the median reduction.
Every warmup and measured run must have exactly equal route hashes, iterations,
solver status, statistics and independent DRC results, otherwise the harness
fails. It does not assert zero DRC errors because a repair-stage snapshot can
retain errors for later pipeline stages.

Optional spatial capture wraps only the optimized untimed warmup. It records
actual build/query counts for every index and complete query windows for the
first two nonempty index builds of each kind. The trace copies numeric bounds at
build/query time and preserves original item-array IDs. It neither retains live
geometry nor truncates a sampled build's query window. Original spatial exports
are restored and checked before measured runs; changing capture counters during
timing makes the harness fail. The output trace is compatible with the spatial
index comparison harness's `SpatialIndexWorkload[]` schema. These sampled
windows are actual repair queries, while generated workloads and the static
initial-geometry fixture in that harness are separate cases.

Local results show the repair-stage effect on this fixed input. The official
autorouter `/benchmark --dataset 18` run remains the evidence for full-pipeline
performance, completion and relaxed DRC across all 16 dataset cases.

## Observed local result

On 2026-10-03 with Bun 1.4.0 on an Intel Xeon Platinum 8573C, three timed runs per
variant gave a 27.83% reduction in median time. Measured runs alternated and no
other CPU-heavy local benchmark ran concurrently. The optimized times show some
variation, so these numbers should not be treated as an exact effect on other
inputs or machines. `native-ccad-aee-result.json.gz` contains the recorded report
with environment and shared dependency information.

| Variant | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: |
| Baseline ccad3906 | 26.325 s | 24.905 s | 26.985 s |
| Optimized aee0ef2 | 18.998 s | 18.380 s | 22.671 s |

All eight runs, including warmups, had the same full output SHA-256
`ba100b78c8fba001bc47ad17a2921f31d9aba4f82ebe8f6eacbf3548b682354a`,
16 iterations and 44 candidate attempts. All solver statistics matched,
including the recorded DRC issue count change from 56 to 26. Independent
validation using the baseline checker found 22 issues and issue score 5.698 in
both outputs, with equal complete error hashes. These are two separately
reported counts from the repair solver and its independent validator.

The optimized untimed warmup built 504 via indexes and 504 segment indexes. Via
indexes received 188,496 queries (374 per build); segment indexes received
1,270,047 queries (2,516–2,541 per build). The committed actual trace contains
four complete sampled windows: two via builds with 136 items and 374 queries
each, and two segment builds with 2,167/2,166 items and 2,541/2,540 queries.
These windows cover 5,829 of the 1,458,543 queries; they are sampled windows,
not the whole chronological run. All 1,008 build counts and complete timing
records are included in the machine-readable report.

## Full-repair tree backend comparison

`scripts/benchmark-repair-spatial-backends.ts` reuses the isolation runner to
compare native optimized grid-bitsets against Flatbush or RBush. Both module
paths must point to distinct, clean worktrees at the same source revision. A
Bun preload changes only the tree worktree's two spatial index exports in the
benchmark subprocess. Production files, all other solver helpers and index
rebuild boundaries remain unchanged. For example:

```sh
bun scripts/benchmark-repair-spatial-backends.ts \
  --backend flatbush \
  --baseline /path/to/aee-grid-worktree/lib/index.ts \
  --optimized /path/to/separate-aee-tree-worktree/lib/index.ts \
  --connectivity-module /path/to/native-connectivity/dist/index.js \
  --rounds 2 --warmups 1 --out repair-flatbush-result.json
```

The tree indexes the same inclusive integer cell ranges as the grid, and every
query returns ascending original input-array IDs. This preserves the complete
candidate set and processing order, including grid false positives. The timer
includes the benchmark adapter's bounds snapshots, conversion and query
counters. The adapter is an experiment, not a proposed production tree
implementation. A `--check-only` run verifies its configuration and bindings
without solving. Successful measured runs must also exercise the injected
backend; counters are recorded in the report.

A limited full-stage comparison used two alternating timed runs per variant
after one warmup each. It confirmed that the Flatbush backend was **22.41%
slower** on this captured input:

| Backend | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: |
| Native optimized grid-bitset | 17.519 s | 17.469 s | 17.570 s |
| Flatbush, same cell candidates | 21.446 s | 20.717 s | 22.175 s |

All six runs had the same full output hash, iterations, statistics and
independent DRC results as the earlier replay. The tree backend executed 3,024
builds and 4,375,629 queries across its three runs, exactly three times the
captured optimized warmup's totals. The complete paired timing report is
`native-bitset-flatbush-result.json.gz`. Its absolute times differ from the
earlier ccad/aee session; compare variants within each paired run.

This agrees with the separate actual-query trace measurements: Flatbush won the
smaller via query batches, while the dominant segment query batches took about
twice as long as optimized bitsets. RBush was slower on those segment batches
too, so no additional full-stage RBush timing was run. Generated workloads and
physical-exact query cases remain useful comparisons, but this experiment
preserves the repair solver's original cell-candidate semantics.
