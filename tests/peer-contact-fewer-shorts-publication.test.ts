import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import { TraceContactRepairSolver } from "../lib"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getPhysicalPeerPairs } from "./fixtures/peerTraceRepair"

type Path = [x: number, y: number][]
type Board = Record<string, Path>

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
]

const toRoutes = (board: Board): HighDensityRoute[] =>
  Object.entries(board).map(([connectionName, path]) => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: path.map(([x, y]) => ({ x, y, z: 0 })),
  }))

const toGraphics = (routes: HighDensityRoute[]): GraphicsObject => ({
  lines: routes.map((route, index) => ({
    points: route.route,
    strokeWidth: route.traceThickness,
    strokeColor: COLORS[index % COLORS.length]!,
    label: route.connectionName,
  })),
})

const describeShorts = (routes: HighDensityRoute[]): string => {
  const pairs = getPhysicalPeerPairs(routes).map((pair) =>
    (JSON.parse(pair) as string[]).join("-"),
  )
  return `${pairs.length} ${pairs.length === 1 ? "short" : "shorts"} (${pairs.join(", ")})`
}

test("contact repair publishes a board with fewer shorts when its one new short cannot be cleared", async () => {
  // A single-layer board, so a crossing has no layer bridge.
  const inputBoard: Board = {
    a: [
      [0, 0],
      [4, 0],
    ],
    b: [
      [1, -2],
      [1, 2],
    ],
    c: [
      [3, -2],
      [3, 2],
    ],
    d: [
      [2, 1],
      [2, 4],
    ],
    e: [
      [1.5, -1],
      [2.5, -1],
    ],
    f: [
      [1.5, -1.5],
      [2.5, -1.5],
    ],
  }
  // The repair lifts "a" over "b" and "c" and reuses the freed corridor for
  // "e" and "f". Its detour crosses "d", and restoring "a" alone would land it
  // on "e", whose own restoration would land on "f".
  const candidateBoard: Board = {
    ...inputBoard,
    a: [
      [0, 0],
      [0, 3],
      [4, 3],
      [4, 0],
    ],
    e: [
      [1.5, 0],
      [2.5, 0],
    ],
    f: [
      [1.5, -1],
      [2.5, -1],
    ],
  }
  const input = toRoutes(inputBoard)
  const candidate = toRoutes(candidateBoard)
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -3, maxX: 5, maxY: 5 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: input.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  expect(getPhysicalPeerPairs(input)).toEqual(['["a","b"]', '["a","c"]'])
  expect(getPhysicalPeerPairs(candidate)).toEqual(['["a","d"]'])

  const solver = new TraceContactRepairSolver({
    srj,
    inputHdRoutes: input,
    hdRoutes: candidate,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    // Each short is one DRC error: the candidate has fewer errors as well.
    drcEvaluator: ({ routes }) => ({
      errors: getPhysicalPeerPairs(routes!).map(() => ({ type: "short" })),
      errorsWithCenters: [],
    }),
  })
  solver.solve()
  const output = solver.getOutput()
  expect(solver.failed).toBe(false)

  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally(
        [toGraphics(input), toGraphics(candidate), toGraphics(output)],
        {
          titles: [
            `Input: ${describeShorts(input)}`,
            `Repaired: ${describeShorts(candidate)}`,
            `Published: ${describeShorts(output)}`,
          ],
        },
      ),
      { backgroundColor: "white", svgWidth: 1500, svgHeight: 600 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
