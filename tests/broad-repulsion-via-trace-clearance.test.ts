import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import {
  applyBroadRepulsionForces,
  getDrcSnapshot,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "../lib/types"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import fixtureJson from "./fixtures/bugreport91-broad-repulsion-clearance/input.json" with {
  type: "json",
}

const fixture = fixtureJson as {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  buggyOutputHdRoutes: HighDensityRoute[]
}
const VIA_ROUTE_NAME =
  "source_trace_104__source_trace_105__source_trace_106__source_trace_108__source_trace_111_mst4"
const TRACE_ROUTE_NAME =
  "source_trace_121__source_trace_122__source_trace_123__source_trace_125__source_trace_127_mst1"
const FOCUS_BOUNDS = {
  minX: 5.9,
  minY: 3.3,
  maxX: 7.2,
  maxY: 5.45,
}

const createConnectivityMap = (srj: SimpleRouteJson): ConnectivityMap => {
  const connMap = new ConnectivityMap({})
  for (const connection of srj.connections) {
    const rootConnectionNames = (
      connection as typeof connection & { __rootConnectionNames?: string[] }
    ).__rootConnectionNames
    connMap.addConnections([[connection.name, ...(rootConnectionNames ?? [])]])
  }
  for (const obstacle of srj.obstacles) {
    connMap.addConnections([
      [obstacle.obstacleId, ...obstacle.connectedTo].filter(
        Boolean,
      ) as string[],
    ])
  }
  return connMap
}

const getTargetClearance = (routes: HighDensityRoute[]): number => {
  const viaRoute = routes.find(
    (route) => route.connectionName === VIA_ROUTE_NAME,
  )!
  const traceRoute = routes.find(
    (route) => route.connectionName === TRACE_ROUTE_NAME,
  )!
  const via = viaRoute.vias[0]!
  let centerlineDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < traceRoute.route.length - 1; index += 1) {
    centerlineDistance = Math.min(
      centerlineDistance,
      pointToSegmentDistance(
        via,
        traceRoute.route[index]!,
        traceRoute.route[index + 1]!,
      ),
    )
  }
  return (
    centerlineDistance -
    viaRoute.viaDiameter / 2 -
    traceRoute.traceThickness / 2
  )
}

const segmentIntersectsFocus = (
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean =>
  Math.max(start.x, end.x) >= FOCUS_BOUNDS.minX &&
  Math.min(start.x, end.x) <= FOCUS_BOUNDS.maxX &&
  Math.max(start.y, end.y) >= FOCUS_BOUNDS.minY &&
  Math.min(start.y, end.y) <= FOCUS_BOUNDS.maxY

const visualizeTargetArea = (
  routes: HighDensityRoute[],
  passes: boolean,
): GraphicsObject => {
  const viaRoute = routes.find(
    (route) => route.connectionName === VIA_ROUTE_NAME,
  )!
  const targetVia = viaRoute.vias[0]!
  const routeColors = new Map([
    [VIA_ROUTE_NAME, "#2563eb"],
    [TRACE_ROUTE_NAME, "#f59e0b"],
  ])
  const requiredTraceCenterlineRadius =
    viaRoute.viaDiameter / 2 + viaRoute.traceThickness / 2 + 0.1

  return {
    coordinateSystem: "cartesian",
    lines: routes
      .filter(
        (route) =>
          route.connectionName === VIA_ROUTE_NAME ||
          route.connectionName === TRACE_ROUTE_NAME,
      )
      .flatMap((route) =>
        route.route.slice(0, -1).flatMap((start, pointIndex) => {
          const end = route.route[pointIndex + 1]!
          if (
            start.z !== end.z ||
            start.z !== 0 ||
            !segmentIntersectsFocus(start, end)
          ) {
            return []
          }
          return [
            {
              points: [start, end],
              strokeColor: routeColors.get(route.connectionName) ?? "#94a3b8",
              strokeWidth: route.traceThickness,
              label: route.connectionName,
            },
          ]
        }),
      ),
    circles: [
      {
        center: targetVia,
        radius: requiredTraceCenterlineRadius,
        fill: passes ? "rgba(34, 197, 94, 0.09)" : "rgba(220, 38, 38, 0.11)",
        stroke: passes ? "#16a34a" : "#dc2626",
        label: "minimum different-net trace centerline radius",
      },
      {
        center: targetVia,
        radius: viaRoute.viaDiameter / 2,
        fill: "rgba(37, 99, 235, 0.55)",
        stroke: "#1d4ed8",
        label: "escape via",
      },
    ],
    rects: [
      ...fixture.srj.obstacles.flatMap((obstacle) => {
        if (obstacle.type !== "rect") return []
        if (
          obstacle.center.x + obstacle.width / 2 < FOCUS_BOUNDS.minX ||
          obstacle.center.x - obstacle.width / 2 > FOCUS_BOUNDS.maxX ||
          obstacle.center.y + obstacle.height / 2 < FOCUS_BOUNDS.minY ||
          obstacle.center.y - obstacle.height / 2 > FOCUS_BOUNDS.maxY
        ) {
          return []
        }
        const clippedMinX = Math.max(
          FOCUS_BOUNDS.minX,
          obstacle.center.x - obstacle.width / 2,
        )
        const clippedMaxX = Math.min(
          FOCUS_BOUNDS.maxX,
          obstacle.center.x + obstacle.width / 2,
        )
        const clippedMinY = Math.max(
          FOCUS_BOUNDS.minY,
          obstacle.center.y - obstacle.height / 2,
        )
        const clippedMaxY = Math.min(
          FOCUS_BOUNDS.maxY,
          obstacle.center.y + obstacle.height / 2,
        )
        return [
          {
            center: {
              x: (clippedMinX + clippedMaxX) / 2,
              y: (clippedMinY + clippedMaxY) / 2,
            },
            width: clippedMaxX - clippedMinX,
            height: clippedMaxY - clippedMinY,
            fill: "rgba(100, 116, 139, 0.22)",
            stroke: "#64748b",
            label: obstacle.obstacleId,
          },
        ]
      }),
      {
        center: {
          x: (FOCUS_BOUNDS.minX + FOCUS_BOUNDS.maxX) / 2,
          y: (FOCUS_BOUNDS.minY + FOCUS_BOUNDS.maxY) / 2,
        },
        width: FOCUS_BOUNDS.maxX - FOCUS_BOUNDS.minX,
        height: FOCUS_BOUNDS.maxY - FOCUS_BOUNDS.minY,
        fill: "rgba(255, 255, 255, 0)",
        stroke: "#0f172a",
        label: "focused target area",
      },
    ],
    points: [],
  }
}

test("broad repulsion preserves via-to-trace clearance while escaping pads", () => {
  const connMap = createConnectivityMap(fixture.srj)
  const outputRoutes = applyBroadRepulsionForces(
    fixture.srj,
    fixture.hdRoutes,
    1,
    3,
    connMap,
  )
  const outputDrc = getDrcSnapshot(
    fixture.srj,
    outputRoutes,
    undefined,
    connMap,
  )

  expect(getTargetClearance(fixture.hdRoutes)).toBeGreaterThanOrEqual(0.1)
  expect(getTargetClearance(outputRoutes)).toBeGreaterThanOrEqual(0.1)
  expect(outputDrc.count).toBe(0)

  const buggyClearance = getTargetClearance(fixture.buggyOutputHdRoutes)
  const fixedClearance = getTargetClearance(outputRoutes)
  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        visualizeTargetArea(fixture.buggyOutputHdRoutes, false),
        visualizeTargetArea(outputRoutes, true),
      ],
      {
        titles: [
          `Before fix: ${buggyClearance.toFixed(3)} mm clearance (FAIL)`,
          `After fix: ${fixedClearance.toFixed(3)} mm clearance (PASS)`,
        ],
      },
    ),
    { backgroundColor: "white", svgWidth: 1100, svgHeight: 560 },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/broad-repulsion-via-trace-clearance.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
