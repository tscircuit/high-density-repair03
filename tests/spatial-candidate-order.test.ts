import { expect, test } from "bun:test"
import {
  createSpatialIndex,
  getSpatialCandidateIndexes,
  type SpatialIndex,
} from "../lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const createReferenceIndex = (
  items: Array<Bounds | undefined>,
  cellSize: number,
): Map<string, number[]> => {
  const index = new Map<string, number[]>()
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const bounds = items[itemIndex]
    if (!bounds) continue
    for (
      let x = Math.floor(bounds.minX / cellSize);
      x <= Math.floor(bounds.maxX / cellSize);
      x++
    ) {
      for (
        let y = Math.floor(bounds.minY / cellSize);
        y <= Math.floor(bounds.maxY / cellSize);
        y++
      ) {
        const key = `${x}:${y}`
        const existing = index.get(key)
        if (existing) existing.push(itemIndex)
        else index.set(key, [itemIndex])
      }
    }
  }
  return index
}

const getReferenceCandidates = (
  index: Map<string, number[]>,
  bounds: Bounds,
  cellSize: number,
): number[] => {
  const candidates = new Set<number>()
  for (
    let x = Math.floor(bounds.minX / cellSize);
    x <= Math.floor(bounds.maxX / cellSize);
    x++
  ) {
    for (
      let y = Math.floor(bounds.minY / cellSize);
      y <= Math.floor(bounds.maxY / cellSize);
      y++
    ) {
      for (const value of index.get(`${x}:${y}`) ?? []) candidates.add(value)
    }
  }
  return [...candidates].sort((left, right) => left - right)
}

test("numeric cells preserve exact string-index candidates and ascending bitset order", () => {
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
      const referenceIndex = createReferenceIndex(items, cellSize)
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
          getReferenceCandidates(referenceIndex, box, cellSize),
        )
        comparisons++
      }
    }
  }
  const index: SpatialIndex = new Map([
    [0, new Map([[0, [128, 31, 0, 31, 257, 32, 511]]])],
  ])
  const box = { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }
  expect(getSpatialCandidateIndexes(index, box, 1)).toEqual([
    0, 31, 32, 128, 257, 511,
  ])
  index.get(0)!.set(0, [10000, 32, 1023])
  expect(getSpatialCandidateIndexes(index, box, 1)).toEqual([32, 1023, 10000])

  const boundaryItems: Array<Bounds | undefined> = [
    { minX: -0, minY: -0, maxX: 0, maxY: 0 },
    { minX: -1, minY: -1, maxX: 0, maxY: 0 },
    undefined,
    { minX: 1, minY: 1, maxX: 1, maxY: 1 },
    { minX: -1000, minY: 2000, maxX: -1000, maxY: 2000 },
    { minX: -2, minY: 3, maxX: 2, maxY: 3 },
  ]
  const boundaryIndex = createSpatialIndex(boundaryItems, (item) => item!, 1)
  const boundaryReference = createReferenceIndex(boundaryItems, 1)
  const boundaryQueries: Bounds[] = [
    { minX: -0, minY: -0, maxX: 0, maxY: 0 },
    { minX: -1, minY: -1, maxX: -1, maxY: -1 },
    { minX: 1, minY: 1, maxX: 1, maxY: 1 },
    { minX: -1000, minY: 2000, maxX: -1000, maxY: 2000 },
    { minX: -2, minY: 3, maxX: 2, maxY: 3 },
    { minX: 8, minY: 8, maxX: 10, maxY: 10 },
    { minX: NaN, minY: 0, maxX: 0, maxY: 0 },
    { minX: 0, minY: NaN, maxX: 0, maxY: 0 },
    { minX: 1, minY: 0, maxX: -1, maxY: 0 },
    { minX: 0, minY: 1, maxX: 0, maxY: -1 },
  ]
  for (const query of boundaryQueries) {
    expect(getSpatialCandidateIndexes(boundaryIndex, query, 1)).toEqual(
      getReferenceCandidates(boundaryReference, query, 1),
    )
  }
  for (const emptyBounds of [
    { minX: NaN, minY: 0, maxX: 0, maxY: 0 },
    { minX: 0, minY: NaN, maxX: 0, maxY: 0 },
    { minX: 1, minY: 0, maxX: -1, maxY: 0 },
    { minX: 0, minY: 1, maxX: 0, maxY: -1 },
  ]) {
    const emptyIndex = createSpatialIndex([emptyBounds], (item) => item, 1)
    expect(emptyIndex.size).toBe(createReferenceIndex([emptyBounds], 1).size)
    expect(getSpatialCandidateIndexes(emptyIndex, box, 1)).toEqual([])
  }
  expect(comparisons).toBe(3200)
})
