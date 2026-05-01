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

const getSpatialCellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

export const createSpatialIndex = <T>(
  items: T[],
  getBounds: (item: T) => Bounds2D,
  cellSize: number,
) => {
  const index = new Map<string, number[]>()

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]
    if (!item) continue
    const cellRange = getSpatialCellRange(getBounds(item), cellSize)

    for (
      let cellX = cellRange.minCellX;
      cellX <= cellRange.maxCellX;
      cellX += 1
    ) {
      for (
        let cellY = cellRange.minCellY;
        cellY <= cellRange.maxCellY;
        cellY += 1
      ) {
        const key = getSpatialCellKey(cellX, cellY)
        const existingIndexes = index.get(key)
        if (existingIndexes) {
          existingIndexes.push(itemIndex)
        } else {
          index.set(key, [itemIndex])
        }
      }
    }
  }

  return index
}

export const getSpatialCandidateIndexes = (
  spatialIndex: Map<string, number[]>,
  bounds: Bounds2D,
  cellSize: number,
) => {
  const candidateIndexes = new Set<number>()
  const cellRange = getSpatialCellRange(bounds, cellSize)

  for (
    let cellX = cellRange.minCellX;
    cellX <= cellRange.maxCellX;
    cellX += 1
  ) {
    for (
      let cellY = cellRange.minCellY;
      cellY <= cellRange.maxCellY;
      cellY += 1
    ) {
      const cellIndexes = spatialIndex.get(getSpatialCellKey(cellX, cellY))
      if (!cellIndexes) continue
      for (const index of cellIndexes) {
        candidateIndexes.add(index)
      }
    }
  }

  return [...candidateIndexes].sort((left, right) => left - right)
}
