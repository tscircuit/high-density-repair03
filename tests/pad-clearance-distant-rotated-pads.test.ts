import { expect, test } from "bun:test"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { findPadClearanceViaPosition } from "../lib/solvers/GlobalDrcForceImproveSolver/findPadClearanceViaPosition"
import { hasNewViaPadOverlap } from "../lib/solvers/GlobalDrcForceImproveSolver/hasNewViaPadOverlap"

test("distant pads preserve the nearest legal escape from rotated pad copper", (): void => {
  for (const offset of [
    { x: 0, y: 0 },
    { x: 13.7, y: -7.3 },
  ]) {
    for (const angle of [0, 30, 45, 90]) {
      const srj: SimpleRouteJson = {
        bounds: {
          minX: offset.x - 20,
          maxX: offset.x + 20,
          minY: offset.y - 20,
          maxY: offset.y + 20,
        },
        layerCount: 2,
        minTraceWidth: 0.1,
        minViaEdgeToPadEdgeClearance: 0.1,
        connections: [],
        obstacles: [
          {
            type: "rect",
            center: offset,
            width: 2,
            height: 0.8,
            ccwRotationDegrees: angle,
            layers: ["top", "bottom"],
            connectedTo: ["foreign"],
          },
        ],
      }
      const route: HighDensityRoute = {
        connectionName: "moving",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: offset.x - 3, y: offset.y - 3, z: 0 },
          { x: offset.x + 3, y: offset.y + 3, z: 0 },
        ],
        vias: [],
      }
      const local = findPadClearanceViaPosition(
        srj,
        route,
        offset,
        0.15,
        [0, 1],
      )
      expect(local).toBeDefined()
      if (!local) throw new Error("Expected a legal escape outside the pad")
      const withDistantPads: SimpleRouteJson = {
        ...srj,
        obstacles: [
          ...srj.obstacles,
          ...Array.from({ length: 100 }, (_, index) => ({
            ...srj.obstacles[0]!,
            center: {
              x: offset.x + 10 + (index % 10) * 0.5,
              y: offset.y + 10 + Math.floor(index / 10) * 0.5,
            },
          })),
        ],
      }
      const result = findPadClearanceViaPosition(
        withDistantPads,
        route,
        offset,
        0.15,
        [0, 1],
      )
      expect(result).toEqual(local)
      const candidate: HighDensityRoute = {
        ...route,
        route: [
          route.route[0]!,
          { ...local, z: 0 },
          { ...local, z: 1 },
          { ...route.route[1]!, z: 1 },
        ],
        vias: [local],
      }
      expect(hasNewViaPadOverlap(withDistantPads, route, candidate)).toBe(false)
      const clearPoint = { x: offset.x - 5, y: offset.y - 5 }
      expect(
        findPadClearanceViaPosition(
          withDistantPads,
          route,
          clearPoint,
          0.15,
          [0, 1],
        ),
      ).toBe(clearPoint)
    }
  }
})
