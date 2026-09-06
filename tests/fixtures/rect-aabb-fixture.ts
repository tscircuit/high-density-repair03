import { expect } from "bun:test"
import {
  AutoroutingDrcEngine,
  type AutoroutingDrcEngineOptions,
  type AutoroutingDrcResult,
} from "../../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
export const createRectAabbFixture = (offset = 0): SimpleRouteJson => ({
  bounds: {
    minX: offset - 10,
    minY: offset - 10,
    maxX: offset + 10,
    maxY: offset + 10,
  },
  layerCount: 2,
  minTraceWidth: 0.1,
  connections: [],
  obstacles: [
    {
      type: "rect",
      center: { x: offset, y: offset },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: ["pcb_smtpad_rect", "foreign_net"],
    },
  ],
})
export const expectRectAabbParity = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  options: AutoroutingDrcEngineOptions = {},
): AutoroutingDrcResult => {
  const original = new AutoroutingDrcEngine(srj, {
    ...options,
    useConservativeRectObstaclePrecheck: false,
  })
  const prechecked = new AutoroutingDrcEngine(srj, {
    ...options,
    useConservativeRectObstaclePrecheck: true,
  })
  const expected = original.evaluate(traces)
  expect(prechecked.evaluate(traces)).toEqual(expected)
  expect(prechecked.lastRunStats).toEqual(original.lastRunStats)
  expect(prechecked.evaluateLegacy(traces)).toEqual(
    original.evaluateLegacy(traces),
  )
  expect(prechecked.lastRunStats).toEqual(original.lastRunStats)
  return expected
}
