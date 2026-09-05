import { expect } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "../../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import { getConnectivityMapFromSimpleRouteJson } from "../../fixture-support/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute, SimpleRouteJson } from "../../lib"

export const expectSrjRepairSnapshot = async (
  srj: SimpleRouteJson,
  input: HighDensityRoute[],
  output: HighDensityRoute[],
  testPath: string,
): Promise<void> => {
  expect(output.map((route) => route.connectionName)).toEqual(
    input.map((route) => route.connectionName),
  )
  for (const [index, route] of input.entries()) {
    const connection = srj.connections.find(
      (candidate) => candidate.name === route.connectionName,
    )!
    expect(connection).toBeDefined()
    expect(connection.pointsToConnect.length).toBeGreaterThanOrEqual(2)
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      expect(
        connection.pointsToConnect.some(
          (point) =>
            Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < 1e-6,
        ),
      ).toBe(true)
    }
    expect(output[index]!.route[0]).toEqual(route.route[0])
    expect(output[index]!.route.at(-1)).toEqual(route.route.at(-1))
  }

  const visualizer = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes: output,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  const svg = getSvgFromGraphicsObject(visualizer.visualize(), {
    backgroundColor: "white",
  })
  await expect(svg).toMatchSvgSnapshot(testPath)
}
