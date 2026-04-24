Copy this folder into another repo when you want the solver logic without
moving the host repo's DRC and force-tuning implementation.

Files in this folder:
- `GlobalDrcForceImproveSolver.ts`
- `types.ts`
- `index.ts`

Host-provided dependencies go through `params.deps`:
- `cloneRoutes`
- `materializeRoutes`
- `getDrcSnapshot`
- `getCenteredErrors`
- `getErrorCenter`
- `getViaDrcIssueCount`
- `applyBroadRepulsionForces`
- `applyDrcErrorForces`
- `getForceScalesForEffort`
- `getMaxPassesForEffort`
- `getMaxCandidateAttemptsForEffort`
- `mapZToLayerName`

Usage:

```ts
const solver = new GlobalDrcForceImproveSolver({
  srj,
  hdRoutes,
  effort: 1,
  drcEvaluator,
  deps: {
    cloneRoutes,
    materializeRoutes,
    getDrcSnapshot,
    getCenteredErrors,
    getErrorCenter,
    getViaDrcIssueCount,
    applyBroadRepulsionForces,
    applyDrcErrorForces,
    getForceScalesForEffort,
    getMaxPassesForEffort,
    getMaxCandidateAttemptsForEffort,
    mapZToLayerName,
  },
})
```
