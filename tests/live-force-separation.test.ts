import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { RELAXED_DRC_OPTIONS } from "../lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import type { Segment } from "../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import {
  areLiveSegmentPairForcesSeparated,
  areLiveSegmentRectForcesSeparated,
} from "../lib/solvers/GlobalDrcForceImproveSolver/liveForceSeparation"
import { applyBroadRepulsionForces } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  CLEARANCE_SLACK,
  COORDINATE_EPSILON,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import {
  getClosestSegmentContact,
  getSegmentRectRepulsion,
} from "./fixtures/frozenForceContactGeometry"
import golden from "./fixtures/live-force-separation-golden.json" with {
  type: "json",
}

type ForceCase = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  events: string[]
}

const createSegment = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Segment => ({
  routeIndex: 0,
  rootConnectionName: "signal",
  startIndex: 0,
  endIndex: 1,
  start: { x: startX, y: startY },
  end: { x: endX, y: endY },
  z: 0,
  radius: 0.05,
})

const createForceCase = (variant: string): ForceCase => {
  const events: string[] = []
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.5 },
        width: 0.8,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "left",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0.5, z: 0 },
        { x: -0.5, y: 0.15, z: 0 },
        { x: 0.5, y: 0.15, z: 0 },
        { x: 2, y: 0.5, z: 0 },
      ],
    },
    {
      connectionName: "right",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0.3, z: 0 },
        { x: -0.5, y: 0.13, z: 0 },
        { x: 0.5, y: 0.13, z: 0 },
        { x: 2, y: 0.3, z: 0 },
      ],
    },
  ]
  if (variant === "center-getter") {
    Object.defineProperty(srj.obstacles[0]!.center, "x", {
      configurable: true,
      enumerable: true,
      get: () => {
        events.push("center.x")
        return 0
      },
    })
  }
  if (variant === "width-getter") {
    Object.defineProperty(srj.obstacles[0]!, "width", {
      configurable: true,
      enumerable: true,
      get: () => {
        events.push("width")
        return 0.8 + (events.length % 2) * 0.00001
      },
    })
  }
  if (variant === "point-getter") {
    Object.defineProperty(routes[0]!.route[1]!, "x", {
      configurable: true,
      enumerable: true,
      get: () => {
        events.push("point.x")
        return -0.5
      },
    })
  }
  return { srj, routes, events }
}

test("closed force separation preserves frozen geometry and whole-force getter output", () => {
  const originalClearance = Object.getOwnPropertyDescriptor(
    RELAXED_DRC_OPTIONS,
    "traceClearance",
  )!
  try {
    Object.defineProperty(RELAXED_DRC_OPTIONS, "traceClearance", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: 0.1,
    })
    const requiredDistance = 0.05 + 0.05 + 0.1 + CLEARANCE_SLACK
    let seed = 1
    const random = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    }
    let certifiedPairs = 0
    let certifiedRectangles = 0
    for (let index = 0; index < 10_000; index++) {
      const left = createSegment(
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
      )
      const right = createSegment(
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
        random() * 20_000 - 10_000,
      )
      if (areLiveSegmentPairForcesSeparated(left, right)) {
        certifiedPairs++
        const contact = getClosestSegmentContact(left, right)
        expect(
          Math.hypot(
            contact.leftPoint.x - contact.rightPoint.x,
            contact.leftPoint.y - contact.rightPoint.y,
          ),
        ).toBeGreaterThan(requiredDistance)
      }
      const obstacle: SimpleRouteJson["obstacles"][number] = {
        type: "rect",
        center: {
          x: random() * 20_000 - 10_000,
          y: random() * 20_000 - 10_000,
        },
        width: random() * 10_000,
        height: random() * 10_000,
        layers: ["top"],
        connectedTo: [],
      }
      if (areLiveSegmentRectForcesSeparated(left, obstacle, requiredDistance)) {
        certifiedRectangles++
        expect(
          getSegmentRectRepulsion(left, obstacle, requiredDistance),
        ).toBeUndefined()
      }
    }
    expect(certifiedPairs).toBeGreaterThan(1_000)
    expect(certifiedRectangles).toBeGreaterThan(1_000)

    const left = createSegment(-0, 0, 1, 0)
    const right = createSegment(0, 0, 1, 0)
    for (const gap of [
      requiredDistance,
      requiredDistance + COORDINATE_EPSILON,
      requiredDistance + COORDINATE_EPSILON - Number.EPSILON,
    ]) {
      right.start.y = gap
      right.end.y = gap
      expect(areLiveSegmentPairForcesSeparated(left, right)).toBeFalse()
    }
    right.start.y = requiredDistance + COORDINATE_EPSILON + 0.000001
    right.end.y = right.start.y
    expect(areLiveSegmentPairForcesSeparated(left, right)).toBeTrue()
    right.start.y = 0
    right.end.y = 0
    expect(areLiveSegmentPairForcesSeparated(left, right)).toBeFalse()
    const rectangle: SimpleRouteJson["obstacles"][number] = {
      type: "rect",
      center: { x: 0, y: 3 },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [],
    }
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, 0.2)).toBeTrue()
    rectangle.center.y = 0
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, 0.2)).toBeFalse()
    for (const value of [NaN, Infinity, -Infinity, 10_000.000001, 1e150]) {
      left.start.x = value
      expect(areLiveSegmentPairForcesSeparated(left, right)).toBeFalse()
      expect(
        areLiveSegmentRectForcesSeparated(left, rectangle, 0.2),
      ).toBeFalse()
    }
    left.start.x = 0
    rectangle.width = -1
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, 0.2)).toBeFalse()
    rectangle.width = Infinity
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, 0.2)).toBeFalse()
    rectangle.width = 1
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, -1)).toBeFalse()
    expect(areLiveSegmentRectForcesSeparated(left, rectangle, NaN)).toBeFalse()
    expect(
      areLiveSegmentRectForcesSeparated(left, rectangle, Infinity),
    ).toBeFalse()

    const boundary = createSegment(-1, 0, 1, 0)
    rectangle.center.y = 0.5 + 0.2 + COORDINATE_EPSILON
    expect(
      areLiveSegmentRectForcesSeparated(boundary, rectangle, 0.2),
    ).toBeFalse()
    rectangle.center.y += 0.000001
    expect(
      areLiveSegmentRectForcesSeparated(boundary, rectangle, 0.2),
    ).toBeTrue()
    boundary.end.x = boundary.start.x
    expect(
      areLiveSegmentRectForcesSeparated(boundary, rectangle, 0.2),
    ).toBeTrue()

    for (const expected of golden.cases) {
      const fixture = createForceCase(expected.variant)
      Object.defineProperty(RELAXED_DRC_OPTIONS, "traceClearance", {
        ...originalClearance,
        value: 0.1,
      })
      if (expected.variant === "clearance-getter") {
        Object.defineProperty(RELAXED_DRC_OPTIONS, "traceClearance", {
          configurable: true,
          enumerable: true,
          get: () => {
            fixture.events.push("traceClearance")
            return 0.1 + (fixture.events.length % 3) * 0.00001
          },
        })
      }
      const output = applyBroadRepulsionForces(
        fixture.srj,
        fixture.routes,
        1,
        1,
        undefined,
        false,
        false,
      )
      expect(output).toEqual(expected.output as HighDensityRoute[])
      expect(fixture.events.length).toBe(expected.eventCount)
      expect(
        createHash("sha256")
          .update(JSON.stringify(fixture.events))
          .digest("hex"),
      ).toBe(expected.eventSha256)
    }
  } finally {
    Object.defineProperty(
      RELAXED_DRC_OPTIONS,
      "traceClearance",
      originalClearance,
    )
  }
})
