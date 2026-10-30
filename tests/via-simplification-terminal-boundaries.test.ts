import { expect, test } from "bun:test"
import type { HighDensityRoute } from "../lib"
import { getTraceViaSimplificationCandidates } from "../lib/solvers/GlobalDrcForceImproveSolver/getTraceViaSimplificationCandidates"

test("via simplification preserves internal terminals and jumper boundaries", () => {
  const route: HighDensityRoute = {
    connectionName: "a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
  }
  const terminal = structuredClone(route)
  terminal.route[2]!.pcb_port_id = "internal-terminal"
  expect([...getTraceViaSimplificationCandidates([terminal])]).toEqual([])
  const jumper = structuredClone(route)
  jumper.route[1]!.toNextSegmentType = "through_obstacle"
  expect([...getTraceViaSimplificationCandidates([jumper])]).toEqual([])
  expect([...getTraceViaSimplificationCandidates([route])]).toHaveLength(2)
  const distantJumper = structuredClone(route)
  distantJumper.route.unshift(
    { x: -1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
  )
  for (const candidate of getTraceViaSimplificationCandidates([
    distantJumper,
  ])) {
    expect(candidate[0]!.route.slice(0, 3)).toEqual(
      distantJumper.route.slice(0, 3),
    )
  }
})
