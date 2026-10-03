import { expect, test } from 'bun:test'
import {
  createSpatialIndex,
  getSpatialCandidateIndexes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"

type Bounds = {minX:number,minY:number,maxX:number,maxY:number}

const getReferenceCandidates = (
  index: Map<string,number[]>,
  bounds: Bounds,
  cellSize: number,
): number[] => {
  const candidates = new Set<number>()
  for (let x=Math.floor(bounds.minX/cellSize);x<=Math.floor(bounds.maxX/cellSize);x++) {
    for (let y=Math.floor(bounds.minY/cellSize);y<=Math.floor(bounds.maxY/cellSize);y++) {
      for (const value of index.get(`${x}:${y}`) ?? []) candidates.add(value)
    }
  }
  return [...candidates].sort((left,right)=>left-right)
}

test('bitset candidate enumeration preserves exact ascending spatial indexes', () => {
  let state = 9182
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  let comparisons = 0
  for (const count of [0, 1, 31, 32, 33, 127, 513, 2000]) {
    const items = Array.from({length:count}, (): {minX:number,minY:number,maxX:number,maxY:number} => {
      const x = random()*100-50
      const y = random()*100-50
      return {minX:x,minY:y,maxX:x+random()*5,maxY:y+random()*5}
    })
    for (const cellSize of [.15,.75,2,10]) {
      const original = createSpatialIndex(items, (item) => item, cellSize)
      const optimized = createSpatialIndex(items, (item) => item, cellSize)
      for (let i=0; i<100; i++) {
        const x=random()*120-60
        const y=random()*120-60
        const box={minX:x,minY:y,maxX:x+random()*20,maxY:y+random()*20}
        expect(getSpatialCandidateIndexes(optimized,box,cellSize)).toEqual(getReferenceCandidates(original,box,cellSize))
        comparisons++
      }
    }
  }
  const original = new Map<string,number[]>([['0:0',[128,31,0,31,257,32,511]]])
  const optimized = new Map<string,number[]>([['0:0',[128,31,0,31,257,32,511]]])
  const box={minX:0,minY:0,maxX:.1,maxY:.1}
  expect(getSpatialCandidateIndexes(optimized,box,1)).toEqual(getReferenceCandidates(original,box,1))
  optimized.set('0:0',[10000,32,1023])
  original.set('0:0',[10000,32,1023])
  expect(getSpatialCandidateIndexes(optimized,box,1)).toEqual(getReferenceCandidates(original,box,1))
  expect(comparisons).toBe(3200)
})
