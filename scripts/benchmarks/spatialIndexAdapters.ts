import Flatbush from "flatbush"
import RBush from "rbush"
import {
  createSpatialIndex,
  getSpatialCandidateIndexes,
} from "../../lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"
import type {
  SpatialIndexBounds,
  SpatialIndexItem,
  SpatialIndexWorkload,
} from "./spatialIndexWorkloads"

export type SpatialIndexAdapter =
  | "grid-set-sort"
  | "grid-bitset"
  | "flatbush"
  | "rbush"
export type SpatialIndexMode = "cell-candidates" | "physical-exact"
export type BuiltSpatialIndex = {
  query: (bounds: SpatialIndexBounds) => number[]
}

type TreeItem = SpatialIndexBounds & { id: number }

const getCellBounds = (
  bounds: SpatialIndexBounds,
  cellSize: number,
): SpatialIndexBounds => ({
  minX: Math.floor(bounds.minX / cellSize),
  minY: Math.floor(bounds.minY / cellSize),
  maxX: Math.floor(bounds.maxX / cellSize),
  maxY: Math.floor(bounds.maxY / cellSize),
})

const slotsByWorkload = new WeakMap<SpatialIndexWorkload, SpatialIndexItem[]>()

const getOriginalSlots = (
  workload: SpatialIndexWorkload,
): SpatialIndexItem[] => {
  const cached = slotsByWorkload.get(workload)
  if (cached) return cached
  if (workload.items.every((item, position) => item.id === position)) {
    slotsByWorkload.set(workload, workload.items)
    return workload.items
  }
  let slotCount = 0
  for (const item of workload.items) {
    slotCount = Math.max(slotCount, item.id + 1)
  }
  const slots = new Array<SpatialIndexItem>(slotCount)
  for (const item of workload.items) slots[item.id] = item
  slotsByWorkload.set(workload, slots)
  return slots
}

const createOriginalGrid = (
  items: SpatialIndexItem[],
  cellSize: number,
): BuiltSpatialIndex => {
  // Original main@6f6e5db grid: store input indexes in every intersected cell,
  // then union queried cells with a Set and sort the resulting indexes.
  const cells = new Map<string, number[]>()
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex]
    if (!item) continue
    const bounds = getCellBounds(item, cellSize)
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        const key = `${x}:${y}`
        const entries = cells.get(key)
        if (entries) entries.push(itemIndex)
        else cells.set(key, [itemIndex])
      }
    }
  }
  return {
    query(bounds): number[] {
      const range = getCellBounds(bounds, cellSize)
      const candidates = new Set<number>()
      for (let x = range.minX; x <= range.maxX; x++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          const entries = cells.get(`${x}:${y}`)
          if (!entries) continue
          for (const id of entries) candidates.add(id)
        }
      }
      return [...candidates].sort((left, right) => left - right)
    },
  }
}

export const buildSpatialIndex = (
  adapter: SpatialIndexAdapter,
  workload: SpatialIndexWorkload,
  mode: SpatialIndexMode,
): BuiltSpatialIndex => {
  const { items, cellSize } = workload
  if (adapter === "grid-set-sort") {
    return createOriginalGrid(getOriginalSlots(workload), cellSize)
  }
  if (adapter === "grid-bitset") {
    const index = createSpatialIndex(
      getOriginalSlots(workload),
      (item) => item,
      cellSize,
    )
    return {
      query: (bounds): number[] =>
        getSpatialCandidateIndexes(index, bounds, cellSize),
    }
  }
  const treeItems: TreeItem[] = items.map((item) => ({
    ...(mode === "cell-candidates" ? getCellBounds(item, cellSize) : item),
    id: item.id,
  }))
  const getQueryBounds = (bounds: SpatialIndexBounds): SpatialIndexBounds =>
    mode === "cell-candidates" ? getCellBounds(bounds, cellSize) : bounds
  if (adapter === "flatbush") {
    if (items.length === 0) return { query: (): number[] => [] }
    const index = new Flatbush(items.length)
    for (const item of treeItems) {
      index.add(item.minX, item.minY, item.maxX, item.maxY)
    }
    index.finish()
    return {
      query(bounds): number[] {
        const box = getQueryBounds(bounds)
        const ids = index
          .search(box.minX, box.minY, box.maxX, box.maxY)
          .map((slot) => items[slot]!.id)
        return ids.sort((left, right) => left - right)
      },
    }
  }
  const index = new RBush<TreeItem>()
  index.load(treeItems)
  return {
    query(bounds): number[] {
      const ids = index.search(getQueryBounds(bounds)).map((item) => item.id)
      return ids.sort((left, right) => left - right)
    },
  }
}

export const getNormalizedExactCandidates = (
  index: BuiltSpatialIndex,
  itemsById: ReadonlyMap<number, SpatialIndexItem>,
  bounds: SpatialIndexBounds,
): number[] => {
  const candidates = index.query(bounds)
  const exact: number[] = []
  for (const id of candidates) {
    const item = itemsById.get(id)!
    if (
      item.minX <= bounds.maxX &&
      item.maxX >= bounds.minX &&
      item.minY <= bounds.maxY &&
      item.maxY >= bounds.minY
    ) {
      exact.push(id)
    }
  }
  return exact
}

export const verifySpatialIndexWorkload = (
  workload: SpatialIndexWorkload,
): {
  cellChecksum: number
  exactChecksum: number
  cellCandidates: number
  exactCandidates: number
} => {
  const itemsById = new Map(workload.items.map((item) => [item.id, item]))
  if (itemsById.size !== workload.items.length) {
    throw new Error(`${workload.name}: duplicate original item ids`)
  }
  if (
    workload.items.some((item) => !Number.isInteger(item.id) || item.id < 0)
  ) {
    throw new Error(
      `${workload.name}: original item ids must be nonnegative integers`,
    )
  }
  const adapters: SpatialIndexAdapter[] = [
    "grid-set-sort",
    "grid-bitset",
    "flatbush",
    "rbush",
  ]
  const cells = adapters.map((adapter) =>
    buildSpatialIndex(adapter, workload, "cell-candidates"),
  )
  const physical = adapters.map((adapter) =>
    buildSpatialIndex(adapter, workload, "physical-exact"),
  )
  let cellChecksum = 2166136261
  let exactChecksum = 2166136261
  let cellCandidates = 0
  let exactCandidates = 0
  for (const bounds of workload.queries) {
    const queryCells = getCellBounds(bounds, workload.cellSize)
    const expectedCells: number[] = []
    const expectedExact: number[] = []
    for (const item of workload.items) {
      const cell = getCellBounds(item, workload.cellSize)
      if (
        cell.minX <= queryCells.maxX &&
        cell.maxX >= queryCells.minX &&
        cell.minY <= queryCells.maxY &&
        cell.maxY >= queryCells.minY
      ) {
        expectedCells.push(item.id)
      }
      if (
        item.minX <= bounds.maxX &&
        item.maxX >= bounds.minX &&
        item.minY <= bounds.maxY &&
        item.maxY >= bounds.minY
      ) {
        expectedExact.push(item.id)
      }
    }
    expectedCells.sort((left, right) => left - right)
    expectedExact.sort((left, right) => left - right)
    for (let slot = 0; slot < adapters.length; slot++) {
      const actualCells = cells[slot]!.query(bounds)
      const actualExact = getNormalizedExactCandidates(
        physical[slot]!,
        itemsById,
        bounds,
      )
      for (const [actual, expected, mode] of [
        [actualCells, expectedCells, "cell-candidates"],
        [actualExact, expectedExact, "physical-exact"],
      ] as const) {
        if (
          actual.length !== expected.length ||
          actual.some((id, position) => id !== expected[position])
        ) {
          throw new Error(
            `${workload.name}: ${adapters[slot]} ${mode} mismatch`,
          )
        }
      }
    }
    cellCandidates += expectedCells.length
    exactCandidates += expectedExact.length
    cellChecksum =
      Math.imul(cellChecksum ^ expectedCells.length, 16777619) >>> 0
    exactChecksum =
      Math.imul(exactChecksum ^ expectedExact.length, 16777619) >>> 0
    for (const id of expectedCells) {
      cellChecksum = Math.imul(cellChecksum ^ id, 16777619) >>> 0
    }
    for (const id of expectedExact) {
      exactChecksum = Math.imul(exactChecksum ^ id, 16777619) >>> 0
    }
  }
  return { cellChecksum, exactChecksum, cellCandidates, exactCandidates }
}
