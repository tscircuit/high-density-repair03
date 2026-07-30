# high-density-repair03

This package contains a `GlobalDrcForceImproveSolver` for improving high-density PCB routes against DRC-style errors. Candidate routes are scored by the built-in `AutoroutingDrcEngine`, a lightweight spatially indexed evaluator designed specifically for the autorouting hot path.

## Install

```bash
bun install 
```

## Develop

Run the solver debugger page:

```bash
bun run start
```

Run tests:

```bash
bun test
```

Run typecheck:

```bash
bun run typecheck
```

## Benchmark

Run either benchmark dataset locally:

```bash
bun run benchmark
bun run benchmark:drc14
bun run benchmark:srj18
```

`bun run benchmark` uses the stored SRJ18 repair inputs by default.

You can also use the shell wrapper, which is the entrypoint used by CI:

```bash
./benchmark.sh
./benchmark.sh 10
./benchmark.sh --dataset srj18 --limit 1
./benchmark.sh --limit all --concurrency 4
./benchmark.sh --scenario-limit 20 --effort 2 --max-iterations 100
```

The benchmark runs either the pinned `dataset-drc14` repair samples or checked-in SRJ18 repair inputs through `GlobalDrcForceImproveSolver`. The SRJ18 fixtures were captured from the exact Pipeline7 boundary immediately before repair03 runs, so the benchmark does not run the full autorouter or depend on `dataset-srj18`. It prints each sample's initial-to-final DRC count, then prints a summary table. By default it writes `benchmark-result.json`; this is generated output and is ignored by git.

Useful options:

- `--dataset drc14|srj18`: choose the dataset (default: `srj18`)
- `--limit` / `--scenario-limit`: run the first N samples, or `all`
- `--concurrency N|auto`: number of Bun workers
- `--effort`: solver effort value
- `--max-iterations`: solver max iteration override
- `--out`: output path for the JSON benchmark report
- `--no-out`: skip writing the JSON report
- `--json`: print the JSON report to stdout
- `--fail-on-drc`: exit non-zero if final DRC issues remain

### Benchmark CI

Benchmark CI can be triggered by commenting on a PR:

```txt
/benchmark [benchmark.sh args...]
```

Examples:

```txt
/benchmark
/benchmark 10
/benchmark --dataset drc14
/benchmark --dataset srj18
/benchmark 1 --dataset srj18
/benchmark all --concurrency 4
/benchmark --scenario-limit all --effort 2
/benchmark --scenario-limit 20 --max-iterations 100
```

PRs with `[BENCHMARK TEST]` in the title run the default SRJ18 benchmark workflow automatically on PR updates. The workflow can also be run manually with `workflow_dispatch`, including dataset, scenario limit, concurrency, effort, max iterations, and ref inputs.

For PR comment runs, CI posts Markdown tables for the PR benchmark and the latest successful matching `main` benchmark artifact when available. The PR table includes deltas versus `main` for DRC counts and timing metrics; it does not compare results from different datasets.

## Usage

The main export is `GlobalDrcForceImproveSolver`:

```ts
import { GlobalDrcForceImproveSolver } from "high-density-repair03"

const solver = new GlobalDrcForceImproveSolver({
  srj: {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    connections: [{ name: "A" }, { name: "B" }],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.1,
  },
  hdRoutes: [
    {
      connectionName: "A",
      route: [
        { x: 1, y: 5, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 9, y: 5, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "B",
      route: [
        { x: 5, y: 1, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 5, y: 9, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ],
  drcEvaluator: ({ traces }) => {
    const horizontal = traces.find((trace) => trace.connection_name === "A")
    const vertical = traces.find((trace) => trace.connection_name === "B")
    const hMid = horizontal?.route[1]
    const vMid = vertical?.route[1]
    if (!hMid || !vMid) return []

    const distance = Math.hypot(hMid.x - vMid.x, hMid.y - vMid.y)
    return distance < 0.15
      ? [
          {
            message: `trace clearance gap: ${distance.toFixed(3)}mm required: 0.150mm`,
            center: { x: (hMid.x + vMid.x) / 2, y: (hMid.y + vMid.y) / 2 },
            pcb_trace_id: "A_0",
          },
        ]
      : []
  },
})

solver.solve()

const output = solver.getOutput()
console.log(output.drc.count)
console.log(output.hdRoutes)
```

## Algorithm

The solver follows the same high-level approach as the `GlobalDrcForceImproveSolver` in `tscircuit-autorouter`:

1. Score the current routed solution with relaxed DRC.
2. Try one broad repulsion pass across vias, traces, and obstacles.
3. If that helps, keep it.
4. Run targeted error-centered force passes using the current DRC error centers.
5. Accept a candidate only when it improves the upstream objective:
   lower DRC count, or for equal count, lower issue score, or for equal count, fewer via DRC issues.

That means this repo is intended to mirror the same repair concept and selection criteria used in the autorouter repo, while exposing a friendlier standalone package API and debugger visualization.

## Input shape

`srj` expects:

- `bounds`: routing area `{ minX, minY, maxX, maxY }`
- `connections`: logical connection list, each with at least `name`
- `obstacles`: rectangular keepouts or copper obstacles
- `layerCount`: board layer count
- `minTraceWidth`: minimum allowed trace width
- `minViaDiameter`: optional via diameter default
- `defaultObstacleMargin`: optional obstacle margin default

`hdRoutes` expects one or more routes shaped like:

```ts
{
  connectionName: "A",
  route: [
    { x: 1, y: 5, z: 0 },
    { x: 5, y: 5, z: 0 },
    { x: 9, y: 5, z: 0 },
  ],
  vias: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
}
```

## DRC Evaluator

The repair solver creates and reuses an `AutoroutingDrcEngine` by default. The engine compiles static SRJ obstacles and connectivity once, then evaluates route-dependent trace segments and vias with a spatial broad phase. It covers the relaxed collision objective used by autorouting:

- trace-to-trace clearance
- trace-to-via clearance
- trace-to-pad/plated-hole clearance
- same-net and different-net via spacing

It intentionally does not replace full-board validation. Benchmark/debug/reference code can continue calling `getDrcSnapshot` without an engine to evaluate through `@tscircuit/checks`.

You can also construct the engine directly:

```ts
import { AutoroutingDrcEngine } from "high-density-repair03"

const engine = new AutoroutingDrcEngine(srj, {
  traceClearance: 0.1,
  viaClearance: 0.1,
  connMap,
})

const result = engine.evaluate(traces)
console.log(result.errors)
console.log(engine.lastRunStats)
```

For specialized or reference evaluation, provide `drcEvaluator` to override the optimized engine. It receives:

- `srj`
- `routes`
- `traces`

The evaluator should return either:

- an array of error objects, or
- an object with `errors` and optional `errorsWithCenters`

For best results, each error should include:

- `message`: used to estimate severity
- `center` or `pcb_center`: the location of the violation
- `pcb_trace_id` for trace-related violations
- `pcb_via_ids` for via-related violations

## Output

`solver.getOutput()` returns:

```ts
{
  hdRoutes: HighDensityRoute[],
  drc: {
    errors: DrcError[],
    count: number,
    issueScore: number,
    traceRouteIndexById: Map<string, number>
  }
}
```

## Using This In `tscircuit-autorouter`

Inside `tscircuit-autorouter`, the solver is typically used as an internal pipeline step after trace widths are assigned:

```ts
import { GlobalDrcForceImproveSolver } from "../../solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"

const solver = new GlobalDrcForceImproveSolver({
  srj: cms.srjWithPointPairs!,
  hdRoutes: cms.traceWidthSolver!.getHdRoutesWithWidths(),
  effort: cms.effort,
})

solver.solve()

const repairedRoutes = solver.getOutput()
```

That is the same pattern used in `AutoroutingPipelineSolver4_TinyHypergraph` in your local `tscircuit-autorouter` checkout.

For direct tests in `tscircuit-autorouter`, usage looks like:

```ts
import { GlobalDrcForceImproveSolver } from "lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver"

const solver = new GlobalDrcForceImproveSolver({
  srj,
  hdRoutes: inputRoutes,
  effort: 1,
})

solver.solve()

const outputRoutes = solver.getOutput()
```

One API difference to keep in mind:

- In `tscircuit-autorouter`, `getOutput()` returns `HighDensityRoute[]`.
- In this standalone repo, `getOutput()` returns `{ hdRoutes, drc }` so you can inspect the resulting DRC snapshot directly.

## Compatibility Export

`MySolver` is still exported as a thin wrapper around `GlobalDrcForceImproveSolver` with empty defaults, mainly for the existing debugger page and smoke tests.
