# Root-filtered via collection: checked list-level equivalence

`RootFilteredViaCollection.lean` proves the root-filter optimization in
`lib/solvers/GlobalDrcForceImproveSolver/solverHelpers.ts` at the ordered-list
algorithm level. It imports only Lean's bundled `Std`, with no external packages.

## Reproduce

With elan installed:

```sh
cd proofs
lean --version
lean RootFilteredViaCollection.lean
```

The `lean-toolchain` pins Lean 4.28.0. On the development machine, the command was
actually run as `~/.elan/bin/lean RootFilteredViaCollection.lean` from this
folder, using Lean 4.28.0, arm64-apple-darwin24.6.0, commit
`7e01a1bf5c70fc6167d49c345d3bf80596e9a79b`, Release. It exited successfully.
Both exported equivalence theorems report only the standard Lean foundations
`propext`, `Classical.choice`, and `Quot.sound`. There are no proof holes,
user-defined axioms, or correctness assumptions that restate either conclusion.

## Claims proved

- `collection_equivalence`: flattening the unchanged per-route scans and then
  filtering emitted records by root yields exactly the same ordered list as
  skipping other-root route scans before flattening. All record fields,
  including original global route indices and opaque payload, are retained.
- `find_filter_eq`: deleting records that cannot satisfy a predicate leaves its
  first matching record unchanged.
- `same_root_site_equivalence`: finding the first record on the target route
  whose point indexes overlap, then selecting records of its root at its site,
  yields exactly the same ordered list before and after root-filtering collection.
  The no-match case is included.

## TypeScript correspondence and explicit boundary assumptions

| Lean object | TypeScript meaning |
| --- | --- |
| `indices` | Original route indices in iteration order; filtering never renumbers them. |
| `rootAt i` | `getRootConnectionName(routes[i])`, using `rootConnectionName ?? connectionName`. |
| `scan i` | The original inner `collectViaNodes` scan of route `i`, with the same default diameter. |
| `Via.root`, `Via.routeIndex` | Emitted `rootConnectionName` and original `routeIndex`. |
| Opaque `payload` | All other via fields: coordinates, point indexes, layers, radius, movement and canonicalization flags. |
| `overlap` | `candidate.pointIndexes.some(pointIndex => via.pointIndexes.includes(pointIndex))`. |
| `sameSite current candidate` | The unchanged `Math.hypot(...) <= COORDINATE_EPSILON` comparison. |
| `findSite` | Existing `getSameRootViaSite` first-match and final same-root site filter. |

The formal assumption `ScanLabels` says only that every emitted via carries its
source route's index and root. These are explicit fields of the existing
`vias.push` object. It does not assume either optimization's correctness.

The model treats per-route scans as pure functions of stable route data. This
matches ordinary route arrays/objects during this synchronous function call:
`seenIndexes` is created independently inside each route iteration, and scanning
one route does not mutate another route or shared collector state. Exotic JS
getters/proxies, mutation during access, exceptions from such access, and changes
to connectivity/root labels during execution are outside the model.

Missing/sparse route slots emit no records. For an absent target route, the
original search cannot find its record; the optimized early return is therefore
also empty. `rootAt` can be assigned any value to absent slots because their scan
is empty. Stale incoming via coordinates or root labels do not affect the proof:
the filter root is taken from the current target route, and matching uses the
incoming point indexes just as before.

Geometry, floating-point arithmetic, stacked-layer grouping, terminal tagging,
and per-route deduplication remain inside the same opaque scan/site operations.
The theorem does not prove those operations geometrically correct; it proves
this optimization preserves their results, even for arbitrary site predicates.
It also does not model allocation identities, garbage collection, exceptions,
resource exhaustion, execution time, or the rest of the routing pipeline.
This is not a mechanically verified translation of TypeScript into Lean.

The focused Bun regression test `tests/collect-via-nodes-root-filter.test.ts`
checks the concrete implementation on shared sites, interleaved roots, original
indices, stacked layers, and terminal metadata. Runtime improvements require
separate measured evidence; these theorems establish no speedup claim.
