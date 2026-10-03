import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

export type SpatialIndexBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type SpatialIndexItem = SpatialIndexBounds & {
  id: number
  kind: "segment" | "via" | "obstacle"
}

export type SpatialIndexWorkload = {
  name: string
  cellSize: number
  items: SpatialIndexItem[]
  queries: SpatialIndexBounds[]
  source: string
  /** Original query count when queries are a deterministic sample of a trace. */
  totalQueryCount?: number
}

export type SpatialIndexPattern =
  | "uniform-random"
  | "clustered-grouped"
  | "long-rectangles-shuffled"

const ITEM_COUNTS = [256, 2048, 16384] as const
const PATTERNS: SpatialIndexPattern[] = [
  "uniform-random",
  "clustered-grouped",
  "long-rectangles-shuffled",
]
const QUERY_COUNT = 1024
const DEFAULT_SEED = 0x51a71a1

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Generates repeatable AABBs; IDs are their final insertion-order indices. */
export const createGeneratedSpatialIndexWorkload = (
  itemCount: number,
  pattern: SpatialIndexPattern,
  seed = DEFAULT_SEED,
): SpatialIndexWorkload => {
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw new Error("Spatial workload itemCount must be a positive integer")
  }
  const random = createRandom(seed + itemCount)
  const cellSize = 1
  const extent = pattern === "long-rectangles-shuffled" ? 128 : 64
  const items: SpatialIndexItem[] = []

  for (let index = 0; index < itemCount; index += 1) {
    let x: number
    let y: number
    if (pattern === "clustered-grouped") {
      const cluster = Math.floor((index * 16) / itemCount)
      x = (cluster % 4) * 12 - 18 + (random() + random() - 1) * 2
      y = Math.floor(cluster / 4) * 12 - 18 + (random() + random() - 1) * 2
    } else {
      x = (random() - 0.5) * extent
      y = (random() - 0.5) * extent
    }

    const kindChoice = random()
    const kind: SpatialIndexItem["kind"] =
      kindChoice < 0.2 ? "via" : kindChoice < 0.35 ? "obstacle" : "segment"
    let dx = 0
    let dy = 0
    if (kind === "obstacle") {
      dx = 0.1 + random() * 1.2
      dy = 0.1 + random() * 1.2
    } else if (kind === "segment") {
      if (pattern === "long-rectangles-shuffled" && index % 3 !== 0) {
        // Thin, axis-aligned boxes span at most 25 cells along their long side.
        const length = 4 + random() * 20
        if (index % 2 === 0) dx = length
        else dy = length
      } else {
        dx = (random() - 0.5) * 2
        dy = (random() - 0.5) * 2
      }
    }

    items.push({
      id: index,
      kind,
      minX: Math.min(x, x + dx),
      minY: Math.min(y, y + dy),
      maxX: Math.max(x, x + dx),
      maxY: Math.max(y, y + dy),
    })
  }

  if (pattern === "long-rectangles-shuffled") {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const otherIndex = Math.floor(random() * (index + 1))
      const item = items[index]!
      items[index] = items[otherIndex]!
      items[otherIndex] = item
    }
    for (let index = 0; index < items.length; index += 1) {
      items[index]!.id = index
    }
  }

  const queries: SpatialIndexBounds[] = []
  for (let index = 0; index < QUERY_COUNT; index += 1) {
    const item = items[(index * 1543 + (seed >>> 0)) % itemCount]!
    const x = item.minX + (item.maxX - item.minX) * random()
    const y = item.minY + (item.maxY - item.minY) * random()
    let halfWidth: number
    let halfHeight: number
    if (pattern === "long-rectangles-shuffled" && index % 4 === 0) {
      halfWidth = 8 + random() * 16
      halfHeight = 2 + random() * 10
    } else if (pattern === "clustered-grouped") {
      halfWidth = 0.08 + random() * 0.32
      halfHeight = 0.08 + random() * 0.32
    } else {
      halfWidth = 0.02 + random() * 0.18
      halfHeight = 0.02 + random() * 0.18
    }
    queries.push({
      minX: x - halfWidth,
      minY: y - halfHeight,
      maxX: x + halfWidth,
      maxY: y + halfHeight,
    })
  }

  return {
    name: `${pattern}-${itemCount}`,
    cellSize,
    items,
    queries,
    source: `Generated static AABBs; seed ${seed >>> 0}, ${pattern}, ${itemCount} items. Queries overlap selected items and are not solver query traces.`,
    totalQueryCount: queries.length,
  }
}

/** Nine generated workloads and a static approximation of captured SRJ18 geometry. */
export const createSpatialIndexWorkloads = (): SpatialIndexWorkload[] => {
  const generated = ITEM_COUNTS.flatMap((itemCount) =>
    PATTERNS.map((pattern) =>
      createGeneratedSpatialIndexWorkload(itemCount, pattern),
    ),
  )
  const fixturePath = new URL(
    "./fixtures/srj18-sample4-spatial.json.gz",
    import.meta.url,
  )
  const realWorkload = JSON.parse(
    gunzipSync(readFileSync(fixturePath)).toString("utf8"),
  ) as SpatialIndexWorkload
  return [...generated, realWorkload]
}
