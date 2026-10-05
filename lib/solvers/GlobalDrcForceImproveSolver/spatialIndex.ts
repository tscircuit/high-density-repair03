import type { SimpleRouteJson } from "../../types"
import type { Bounds2D, Point } from "./internalTypes"

export const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(value, maxValue))

export const clampToBounds = (
  point: Point,
  bounds: SimpleRouteJson["bounds"],
) => {
  point.x = clampValue(point.x, bounds.minX, bounds.maxX)
  point.y = clampValue(point.y, bounds.minY, bounds.maxY)
}

export const expandBounds2d = (bounds: Bounds2D, margin: number): Bounds2D => ({
  minX: bounds.minX - margin,
  minY: bounds.minY - margin,
  maxX: bounds.maxX + margin,
  maxY: bounds.maxY + margin,
})

const getSpatialCellRange = (bounds: Bounds2D, cellSize: number) => ({
  minCellX: Math.floor(bounds.minX / cellSize),
  maxCellX: Math.floor(bounds.maxX / cellSize),
  minCellY: Math.floor(bounds.minY / cellSize),
  maxCellY: Math.floor(bounds.maxY / cellSize),
})

export type SpatialIndex = Map<number, Map<number, number[]>>

type SpatialQueryScratch = {
  bits: Uint32Array
  wordGenerations: Uint32Array
  generation: number
}

const queryScratchByIndex = new WeakMap<SpatialIndex, SpatialQueryScratch>()

export const createSpatialIndex = <T>(
  items: T[],
  getBounds: (item: T) => Bounds2D,
  cellSize: number,
): SpatialIndex => {
  const index: SpatialIndex = new Map()
  const wordCount = Math.ceil(items.length / 32)
  queryScratchByIndex.set(index, {
    bits: new Uint32Array(wordCount),
    wordGenerations: new Uint32Array(wordCount),
    generation: 0,
  })

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]
    if (!item) continue
    const cellRange = getSpatialCellRange(getBounds(item), cellSize)

    for (
      let cellX = cellRange.minCellX;
      cellX <= cellRange.maxCellX;
      cellX += 1
    ) {
      let column = index.get(cellX)
      for (
        let cellY = cellRange.minCellY;
        cellY <= cellRange.maxCellY;
        cellY += 1
      ) {
        if (!column) {
          column = new Map()
          index.set(cellX, column)
        }
        const existingIndexes = column.get(cellY)
        if (existingIndexes) {
          existingIndexes.push(itemIndex)
        } else {
          column.set(cellY, [itemIndex])
        }
      }
    }
  }

  return index
}

export const getSpatialCandidateIndexes = (
  spatialIndex: SpatialIndex,
  bounds: Bounds2D,
  cellSize: number,
): number[] => {
  let scratch = queryScratchByIndex.get(spatialIndex)
  if (!scratch) {
    scratch = {
      bits: new Uint32Array(0),
      wordGenerations: new Uint32Array(0),
      generation: 0,
    }
    queryScratchByIndex.set(spatialIndex, scratch)
  }
  scratch.generation += 1
  if (scratch.generation > 0xffffffff) {
    scratch.wordGenerations.fill(0)
    scratch.generation = 1
  }
  const generation = scratch.generation
  const cellRange = getSpatialCellRange(bounds, cellSize)
  let minWordIndex = Infinity
  let maxWordIndex = -1

  for (
    let cellX = cellRange.minCellX;
    cellX <= cellRange.maxCellX;
    cellX += 1
  ) {
    const column = spatialIndex.get(cellX)
    for (
      let cellY = cellRange.minCellY;
      cellY <= cellRange.maxCellY;
      cellY += 1
    ) {
      const cellIndexes = column?.get(cellY)
      if (!cellIndexes) continue
      for (const index of cellIndexes) {
        const wordIndex = index >>> 5
        if (wordIndex >= scratch.bits.length) {
          const wordCount = Math.max(wordIndex + 1, scratch.bits.length * 2)
          const nextBits = new Uint32Array(wordCount)
          nextBits.set(scratch.bits)
          const nextGenerations = new Uint32Array(wordCount)
          nextGenerations.set(scratch.wordGenerations)
          scratch.bits = nextBits
          scratch.wordGenerations = nextGenerations
        }
        if (scratch.wordGenerations[wordIndex] !== generation) {
          scratch.wordGenerations[wordIndex] = generation
          scratch.bits[wordIndex] = 0
        }
        scratch.bits[wordIndex] = scratch.bits[wordIndex]! | (1 << (index & 31))
        if (wordIndex < minWordIndex) minWordIndex = wordIndex
        if (wordIndex > maxWordIndex) maxWordIndex = wordIndex
      }
    }
  }

  // Bit positions retain the original item order across overlapping cells,
  // without allocating a Set or sorting a fresh array for every query.
  const candidateIndexes: number[] = []
  for (
    let wordIndex = minWordIndex;
    wordIndex <= maxWordIndex;
    wordIndex += 1
  ) {
    if (scratch.wordGenerations[wordIndex] !== generation) continue
    let bits = scratch.bits[wordIndex]!
    while (bits !== 0) {
      const bitIndex = 31 - Math.clz32(bits & -bits)
      candidateIndexes.push(wordIndex * 32 + bitIndex)
      bits &= bits - 1
    }
  }
  return candidateIndexes
}
