# Spatial index comparison

Run from the repository root after `bun install`:

```sh
bun run benchmark:spatial-index --trials 9 --warmups 3 --min-trial-ms 30 \
  --out /tmp/repair-spatial-benchmark.json
```

Use `--only segment-build` to measure the two captured segment windows, or
`--only uniform-random-16384` for one generated case. The script prints one
summary table per case and writes all trial samples, median/minimum/maximum,
candidate counts, checksums, runtime, CPU, and installed tree versions to JSON.
Query and estimated total reductions are calculated relative to the original
grid; negative reductions mean that adapter took longer. In physical mode,
the printed reduction compares query plus identical exact filtering.
Flatbush 4.5.0 and RBush 4.0.1 are exactly pinned development dependencies.

The production-compatible `cell-candidates` mode compares:

- The original Map-of-cells grid, unioned with a Set and sorted by numeric ID.
- The production optimized grid, unioned with generation-stamped bitsets.
- Flatbush, bulk-built with integer cell-range rectangles.
- RBush, bulk-loaded with the same integer cell-range rectangles.

Every rectangle and query is converted using the same inclusive
`floor(coordinate / cellSize)` boundaries. Integer rectangle intersection is
equivalent to sharing at least one original grid cell. Trees enumerate their
native results and sort original item IDs; the bitset enumerates in ascending
order. Original IDs, including holes, are preserved. Before timing, a brute-force
oracle checks the complete ordered result array of every adapter for every
query. Checksums are a reporting aid, not a substitute for these comparisons.
Boundary, duplicate-box, sparse-ID and empty-index cases also have regression
tests.

The separate `physical-exact` mode compares physical-AABB tree queries against
coarse grid queries, followed by the same exact-AABB filter. All query outputs
are sorted once and filtering preserves their order. Its `exact` timing includes
querying, enumeration, sorting and filtering. A physical tree is not an
equivalent replacement for the repair grid: repair passes retain snapshot cell
membership while moving geometry, so original false positives can become
relevant during that pass. This mode is an independent static workload.

Build timing includes cell/tree construction, transformation and bulk loading.
The constructed index escapes into a module sink and its query result is
consumed outside the construction timer. Query timing covers an entire workload
batch. Jobs are calibrated to a minimum duration, warmed up and rotated across
adapters and build/query tasks for each trial. Build+batch numbers are estimates
formed by summing separately measured medians, not medians of combined timed
runs. If a future trace samples query windows, the explicitly labeled all-query
estimate weights batch time by `totalQueryCount / queries.length`.

## Workloads

`spatialIndexWorkloads.ts` deterministically generates nine cases using seed
`0x51a71a1`: 256, 2,048 and 16,384 items, each with 1,024 query windows. Cases
cover uniform geometry with spatially scattered insertion IDs, grouped clusters,
and long thin rectangles with shuffled insertion IDs and some wider windows.
They mix segment, via and obstacle boxes. Queries intentionally overlap selected
items; these are constructed distributions rather than a repair query-frequency
model. Small sparse candidates and scattered IDs can expose bitset word-scanning
costs, while clustered candidates can reduce that cost.

`scripts/benchmarks/fixtures/srj18-sample4-spatial.json.gz` is a static mixed
approximation of captured Pipeline9 SRJ18 sample004 geometry: 2,167 segments,
136 vias and 238 obstacles in one index, with 1,024 generated windows. Production
repair instead maintains separate via/segment indexes and queries obstacles
against them. Its source records the original constructor capture hash,
capture mechanism and absence of a recorded source commit. This is different
from the historical Pipeline7 data in `benchmarks/srj18`.

`fixtures/repair-spatial-query-trace.json.gz` contains four actual complete
build/query windows from the optimized repair replay: two via snapshots with
136 items and 374 queries each, and two segment snapshots with 2,167/2,166 items
and 2,541/2,540 queries. Each snapshot copies numeric bounds at build time and
queries at query time; live geometry is not retained. All 5,829 queries in these
four windows are timed, so their build/query amortization uses actual counts.
They are the first two sampled builds per kind, not all 1,008 builds in the full
repair run. See `benchmarks/repair-isolation/reproduce.md` for their capture and
the separate full-repair comparison with native connectivity.

These benchmarks change no production algorithms, thresholds or repair settings.
Only an official autorouter dataset18 benchmark can establish full-pipeline
completion, relaxed DRC passing and runtime across all dataset cases.

## Observed local result

On 2026-10-03, Bun 1.4.0 on an Intel Xeon Platinum 8573C measured nine trials
after three warmups, with no concurrent CPU-heavy local work. All 14 workloads
passed the full ordered oracle comparisons in both modes.
`observed-result.json.gz` records every sample and the environment. Times below
are median milliseconds per complete query window in `cell-candidates` mode:

| Actual captured window | Original grid | Bitset grid | Flatbush | RBush |
| --- | ---: | ---: | ---: | ---: |
| Via build 0: 136 items, 374 queries | 0.2905 | 0.2090 | 0.1175 | 0.2365 |
| Segment build 1: 2,167 items, 2,541 queries | 11.9808 | 4.3284 | 9.3027 | 13.5282 |
| Via build 2: 136 items, 374 queries | 0.2758 | 0.2105 | 0.1184 | 0.2194 |
| Segment build 3: 2,166 items, 2,540 queries | 11.7309 | 4.4356 | 9.4289 | 13.0368 |

For the segment windows, bitset query medians fell 63.9% and 62.2%; their
estimated build+query costs fell 61.6% and 59.6%. Bitset construction medians
were 0.4681/0.5081 ms, versus original-grid 0.5051/0.5157 ms. The original query
ranges were 11.3472–12.5738 and 11.1233–13.0050 ms; bitset ranges were
4.1392–4.8311 and 4.0600–4.8704 ms. The machine-readable report is authoritative
for all individual samples.

Summing the four window query medians gives 24.2780 ms for the original grid,
9.1835 ms for bitsets, 18.9674 ms for Flatbush and 27.0208 ms for RBush.
Adding their separate build medians gives estimated totals of 25.3549, 10.2059,
19.8425 and 28.1054 ms: a 59.7% reduction for bitsets across these sampled
windows. This is not a measured full-repair timing or an extrapolation to all
1,458,543 queries.

Flatbush won the small via windows and the long-rectangle generated cases.
Bitsets won the clustered generated cases, while sparse scattered-ID queries
with 16,384 items were slower: 1.7970 ms original versus 2.8455 ms bitset
(58.3% more query time). Their estimated build+query totals were 9.9465 versus
10.1377 ms. Static mixed captured geometry favored bitsets, with query time
45.3181 to 11.6430 ms; that constructed distribution is distinct from actual
repair windows. These results show why item count, ID locality, window size and
construction amortization matter.

For a separate exact physical-AABB output contract, Flatbush was fastest in all
four captured windows: query+filter medians were 0.1469/7.0762/0.1278/7.4773 ms,
versus original-grid 0.3348/13.3057/0.3036/14.4614 ms. Those comparisons include
the identical final filter and ordered output. The raw physical query column
has different intermediate candidate counts and should not be used alone to
claim equivalent-query speed.
