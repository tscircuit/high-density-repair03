import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"

type CacheInternals = {
  getPrimitiveId: (values: unknown[]) => number | undefined
  runCachedQuery: (key: string, compute: () => []) => unknown[]
  primitiveIdsByKey: Map<string, { id: number; units: number }>
  queryResultCache: Map<string, { units: number }>
  primitiveKeyUnits: number
  queryResultUnits: number
}

test("FIFO eviction preserves resident entries across churn, full eviction, and connectivity reset", (): void => {
  const engine = new AutoroutingDrcEngine(
    {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
      connections: [],
      obstacles: [],
    },
    { queryResultCacheBudget: 4096 },
  )
  const cache = engine as unknown as CacheInternals
  const primitiveReference = new Map<string, { id: number; units: number }>()
  const queryReference = new Map<string, { units: number }>()
  let nextId = 0
  let primitiveUnits = 0
  let queryUnits = 0
  let computations = 0
  let expectedComputations = 0
  const compute = (): [] => {
    computations++
    return []
  }
  for (let i = 0; i < 2000; i++) {
    // Variable entry sizes force both single and multiple evictions. Periodic
    // hits must not promote entries, and a nearly full-size entry drains FIFO.
    const key =
      i % 17 === 0
        ? "hit"
        : `${i}:` + "x".repeat(i % 31 === 0 ? 900 : i % 70)
    const serialized = JSON.stringify([key])
    const units = serialized.length + 64
    let entry = primitiveReference.get(serialized)
    if (!entry) {
      while (primitiveUnits + units > 1024) {
        const [oldestKey, oldest] = primitiveReference.entries().next().value!
        primitiveUnits -= oldest.units
        primitiveReference.delete(oldestKey)
      }
      entry = { id: nextId++, units }
      primitiveReference.set(serialized, entry)
      primitiveUnits += units
    }
    expect(cache.getPrimitiveId([key])).toBe(entry.id)
    expect([...cache.primitiveIdsByKey]).toEqual([...primitiveReference])
    expect(cache.primitiveKeyUnits).toBe(primitiveUnits)

    const queryKey = i % 37 === 0 ? "z".repeat(3000) : key
    if (!queryReference.has(queryKey)) {
      expectedComputations++
      const querySize = queryKey.length + 64
      while (queryUnits + querySize > 3072) {
        const [oldestKey, oldest] = queryReference.entries().next().value!
        queryUnits -= oldest.units
        queryReference.delete(oldestKey)
      }
      queryReference.set(queryKey, { units: querySize })
      queryUnits += querySize
    }
    expect(cache.runCachedQuery(queryKey, compute)).toEqual([])
    expect([...cache.queryResultCache.keys()]).toEqual([...queryReference.keys()])
    expect(cache.queryResultUnits).toBe(queryUnits)
    expect(computations).toBe(expectedComputations)
    if (i === 999) {
      // First evaluation initializes connectivity and clears the query cache.
      engine.evaluate([])
      queryReference.clear()
      // Empty evaluation caches the empty via-pair query after invalidation.
      queryReference.set("via-pairs:", { units: 74 })
      queryUnits = 74
      expect([...cache.queryResultCache.keys()]).toEqual(["via-pairs:"])
    }
  }
})
