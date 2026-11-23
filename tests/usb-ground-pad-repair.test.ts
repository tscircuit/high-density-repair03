import { expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "../fixture-support/getConnectivityMapFromSimpleRouteJson"
import {
  GlobalDrcBranchPortfolioSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { getPhysicalSmtPadOverlaps } from "./fixtures/getPhysicalSmtPadOverlaps"
import { expectSrjRepairSnapshot } from "./fixtures/expectSrjRepairSnapshot"
import input from "./fixtures/usb-ground-pad-repair.json"

test("repair the USB ground trace beside MCU pin 15", async () => {
  const { srj, hdRoutes } = structuredClone(input) as {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(getPhysicalSmtPadOverlaps(srj, hdRoutes, connMap)).toHaveLength(1)
  const solver = new GlobalDrcBranchPortfolioSolver({
    srj,
    hdRoutes,
    connMap,
    broadMaxIterations: 12,
    broadPassMultiplier: 3,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(getPhysicalSmtPadOverlaps(srj, solver.getOutput(), connMap)).toEqual(
    [],
  )
  // Keep both routes in the solver, then zoom the snapshot to the USB ground escape.
  const ground = hdRoutes.find(
    (route) => route.connectionName === "source_net_0_mst46",
  )!
  const output = solver
    .getOutput()
    .find((route) => route.connectionName === ground.connectionName)!
  const view = {
    ...srj,
    bounds: { minX: -3, maxX: 2, minY: -11, maxY: -5.5 },
    connections: srj.connections.filter(
      (connection) => connection.name === ground.connectionName,
    ),
  }
  await expectSrjRepairSnapshot(
    view,
    [ground],
    [output],
    import.meta.path,
    solver.stats.finalDrcIssueCount,
  )
})
