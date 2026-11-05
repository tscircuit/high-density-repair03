import { expect, test } from "bun:test"
import {
  createSpatialIndex,
  getSpatialCandidateIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const getReferenceCandidates = (
  items: Bounds[],
  bounds: Bounds,
  cellSize: number,
): number[] => {
  // Independent exhaustive oracle: intersect quantized cell ranges, preserving
  // original item order without consulting the optimized index's storage.
  const candidates: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (
      Math.floor(item.minX / cellSize) <= Math.floor(bounds.maxX / cellSize) &&
      Math.floor(item.maxX / cellSize) >= Math.floor(bounds.minX / cellSize) &&
      Math.floor(item.minY / cellSize) <= Math.floor(bounds.maxY / cellSize) &&
      Math.floor(item.maxY / cellSize) >= Math.floor(bounds.minY / cellSize)
    )
      candidates.push(i)
  }
  return candidates
}

test("bitset candidate enumeration preserves exact ascending spatial indexes", () => {
  let state = 9182
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  let comparisons = 0
  for (const count of [0, 1, 31, 32, 33, 127, 513, 2000]) {
    const items = Array.from({ length: count }, (): Bounds => {
      const x = random() * 100 - 50
      const y = random() * 100 - 50
      return {
        minX: x,
        minY: y,
        maxX: x + random() * 5,
        maxY: y + random() * 5,
      }
    })
    for (const cellSize of [0.15, 0.75, 2, 10]) {
      const index = createSpatialIndex(items, (item) => item, cellSize)
      for (let query = 0; query < 100; query++) {
        const x = random() * 120 - 60
        const y = random() * 120 - 60
        const box = {
          minX: x,
          minY: y,
          maxX: x + random() * 20,
          maxY: y + random() * 20,
        }
        expect(getSpatialCandidateIndexes(index, box, cellSize)).toEqual(
          getReferenceCandidates(items, box, cellSize),
        )
        comparisons++
      }
    }
  }
  const index = new Map<number, Map<number, number[]>>([
    [0, new Map([[0, [128, 31, 0, 31, 257, 32, 511]]])],
  ])
  const box = { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }
  expect(getSpatialCandidateIndexes(index, box, 1)).toEqual([
    0, 31, 32, 128, 257, 511,
  ])
  index.get(0)!.set(0, [10000, 32, 1023])
  expect(getSpatialCandidateIndexes(index, box, 1)).toEqual([32, 1023, 10000])
  expect(comparisons).toBe(3200)
})
