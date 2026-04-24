# high-density-repair03

This package contains a `GlobalDrcForceImproveSolver` for improving high-density PCB routes against DRC-style errors.

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

This repo does not bundle a full PCB DRC engine. Instead, you provide `drcEvaluator`, which receives:

- `srj`
- `routes`
- `traces`

It should return either:

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
