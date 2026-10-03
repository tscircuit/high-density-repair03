import { expect, test } from "bun:test"
import { verifySpatialIndexWorkload } from "../scripts/benchmarks/spatialIndexAdapters"

test("benchmark adapters support empty repair index snapshots", () => {
  const parity = verifySpatialIndexWorkload({
    name: "empty-via-snapshot",
    source: "empty repair-pass index with nonempty query windows",
    cellSize: 1,
    items: [],
    queries: [
      { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    ],
  })
  expect(parity.cellCandidates).toBe(0)
  expect(parity.exactCandidates).toBe(0)
})
