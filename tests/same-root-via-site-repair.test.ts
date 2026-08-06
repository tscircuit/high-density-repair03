import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import {
  applyDrcErrorForces,
  cloneRoutes,
} from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"

const srj: SimpleRouteJson = {
  bounds: { minX: -1.25, minY: -1.25, maxX: 1.25, maxY: 1.25 },
  connections: [],
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "signal_mst0",
    rootConnectionName: "signal",
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "signal_mst1",
    rootConnectionName: "signal",
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
  {
    connectionName: "foreign",
    rootConnectionName: "foreign",
    route: [
      { x: 0.18, y: -1, z: 0 },
      { x: 0.18, y: 1, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  },
]

const getViaPosition = (route: HighDensityRoute) => {
  const transitionIndex = route.route.findIndex(
    (point, index) => point.z !== route.route[index + 1]?.z,
  )
  return route.route[transitionIndex]!
}

const getViaSiteSeparation = (routes: HighDensityRoute[]) => {
  const [firstVia, secondVia] = routes.slice(0, 2).map(getViaPosition)
  return Math.hypot(firstVia!.x - secondVia!.x, firstVia!.y - secondVia!.y)
}

const VIA_SITE_CLOSE_UP_SCALE = 100

const visualizeViaSiteCloseUp = (
  routes: HighDensityRoute[],
): GraphicsObject => {
  const sharedViaPositions = routes.slice(0, 2).map(getViaPosition)
  const midpoint = {
    x: (sharedViaPositions[0]!.x + sharedViaPositions[1]!.x) / 2,
    y: (sharedViaPositions[0]!.y + sharedViaPositions[1]!.y) / 2,
  }
  const closeUpPositions = sharedViaPositions.map((position) => ({
    x: (position.x - midpoint.x) * VIA_SITE_CLOSE_UP_SCALE,
    y: (position.y - midpoint.y) * VIA_SITE_CLOSE_UP_SCALE,
  }))

  return {
    coordinateSystem: "cartesian",
    lines: [
      {
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        strokeColor: "#cbd5e1",
        strokeWidth: 0.02,
        label: "close-up x axis",
      },
      ...(getViaSiteSeparation(routes) > 1e-6
        ? [
            {
              points: closeUpPositions,
              strokeColor: "#dc2626",
              strokeWidth: 0.06,
              label: "magnified same-root via separation",
            },
          ]
        : []),
    ],
    circles: closeUpPositions.map((position, index) => ({
      center: position,
      radius: 0.12 + index * 0.08,
      fill:
        index === 0 ? "rgba(37, 99, 235, 0.35)" : "rgba(124, 58, 237, 0.25)",
      stroke: index === 0 ? "#2563eb" : "#7c3aed",
      label: routes[index]!.connectionName,
    })),
    rects: [
      {
        center: { x: 0, y: 0 },
        width: 2.5,
        height: 2.5,
        fill: "rgba(255, 255, 255, 0)",
        stroke: "#0f172a",
        label: "close-up bounds",
      },
    ],
    points: [],
  }
}

const visualizeRoutes = (routes: HighDensityRoute[]): GraphicsObject => {
  const routeColors = ["#2563eb", "#7c3aed", "#dc2626"]
  const sharedViaPositions = routes.slice(0, 2).map(getViaPosition)
  const sharedViaSeparation = getViaSiteSeparation(routes)
  const separationMarkerY = 0.32

  return {
    coordinateSystem: "cartesian",
    lines: [
      ...routes.flatMap((route, routeIndex) =>
        route.route.slice(0, -1).flatMap((start, pointIndex) => {
          const end = route.route[pointIndex + 1]!
          if (start.z !== end.z) return []
          return [
            {
              points: [start, end],
              strokeColor: routeColors[routeIndex],
              strokeWidth: route.traceThickness,
              label: `${route.connectionName} z${start.z}`,
            },
          ]
        }),
      ),
      ...(sharedViaSeparation > 1e-6
        ? [
            ...sharedViaPositions.map((position) => ({
              points: [position, { x: position.x, y: separationMarkerY }],
              strokeColor: "#dc2626",
              strokeWidth: 0.025,
              strokeDash: "0.04 0.025",
              label: "split via position guide",
            })),
            {
              points: sharedViaPositions.map((position) => ({
                x: position.x,
                y: separationMarkerY,
              })),
              strokeColor: "#dc2626",
              strokeWidth: 0.06,
              label: "same-root via separation",
            },
          ]
        : []),
    ],
    circles: sharedViaPositions.map((position, index) => ({
      center: position,
      radius: 0.11 + index * 0.055,
      fill: index === 0 ? "rgba(37, 99, 235, 0.3)" : "rgba(124, 58, 237, 0.2)",
      stroke: routeColors[index],
      label: routes[index]!.connectionName,
    })),
    rects: [
      {
        center: { x: 0, y: 0 },
        width: 2.5,
        height: 2.5,
        fill: "rgba(255, 255, 255, 0)",
        stroke: "#0f172a",
        label: "board bounds",
      },
    ],
    points: [],
  }
}

test("visualizes repair of a shared same-root via site", () => {
  const routes = cloneRoutes(inputRoutes)
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["signal_mst0", "signal"],
    ["signal_mst1", "signal"],
  ])

  const changed = applyDrcErrorForces(
    srj,
    routes,
    [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: "via_0",
        pcb_trace_id: "foreign_0",
        center: { x: 0.09, y: 0 },
        message: "signal via is too close to the foreign trace",
      },
    ],
    new Map([["foreign_0", 2]]),
    1,
    connMap,
  )

  expect(changed).toBe(true)

  const outputViaSiteSeparation = getViaSiteSeparation(routes)
  const outputStatusTitle =
    outputViaSiteSeparation > 1e-6
      ? `BUG: ${outputViaSiteSeparation.toFixed(3)} mm split`
      : "FIX: copies colocated"

  const snapshotSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        visualizeRoutes(inputRoutes),
        visualizeRoutes(routes),
        visualizeViaSiteCloseUp(routes),
      ],
      {
        titles: [
          "Before",
          "After",
          `${outputStatusTitle} (${VIA_SITE_CLOSE_UP_SCALE}x)`,
        ],
      },
    ),
    { backgroundColor: "white", svgWidth: 1350, svgHeight: 480 },
  ).replace(/[ \t]+$/gm, "")
  const snapshotPath = new URL(
    "./__snapshots__/same-root-via-site-repair.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
