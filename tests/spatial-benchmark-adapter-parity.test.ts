import { expect, test } from "bun:test"
import {
  buildSpatialIndex,
  getNormalizedExactCandidates,
  verifySpatialIndexWorkload,
} from "../scripts/benchmarks/spatialIndexAdapters"
import type { SpatialIndexWorkload } from "../scripts/benchmarks/spatialIndexWorkloads"

test("benchmark adapters preserve shared-cell membership and sparse original ids", () => {
  const workload: SpatialIndexWorkload = {
    name: "boundary-and-sparse-ids",
    source: "explicit boundaries, duplicate boxes, and original-id holes",
    cellSize: 1,
    items: [
      { id: 0, kind: "via", minX: -0.9, minY: 0, maxX: -0.8, maxY: 0 },
      { id: 31, kind: "segment", minX: 0, minY: 0, maxX: 1, maxY: 0 },
      { id: 32, kind: "obstacle", minX: 1, minY: 0, maxX: 1, maxY: 1 },
      { id: 513, kind: "obstacle", minX: 1, minY: 0, maxX: 1, maxY: 1 },
    ],
    queries: [
      { minX: -0.1, minY: 0, maxX: -0.1, maxY: 0 },
      { minX: 1, minY: 0, maxX: 1, maxY: 0 },
      { minX: 10, minY: 10, maxX: 11, maxY: 11 },
    ],
  }
  const parity = verifySpatialIndexWorkload(workload)
  expect(parity.cellCandidates).toBe(4)
  expect(parity.exactCandidates).toBe(3)
  const cells = buildSpatialIndex("flatbush", workload, "cell-candidates")
  expect(cells.query(workload.queries[0]!)).toEqual([0])
  expect(cells.query(workload.queries[1]!)).toEqual([31, 32, 513])
  const exact = buildSpatialIndex("grid-bitset", workload, "physical-exact")
  const items = new Map(workload.items.map((item) => [item.id, item]))
  expect(
    getNormalizedExactCandidates(exact, items, workload.queries[0]!),
  ).toEqual([])
})
