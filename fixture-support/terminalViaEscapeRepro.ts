import {
  AutoroutingDrcEngine,
  FinePitchPadEscapeSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"

export const createTerminalViaEscapeRepro = (): {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  solver: FinePitchPadEscapeSolver
} => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.05,
    connections: [],
    obstacles: [-0.4, 0, 0.4].flatMap((x, column) =>
      [-0.4, 0, 0.4].map((y, row) => ({
        type: "rect" as const,
        shape: "circle" as const,
        obstacleId: `pcb_smtpad_${column}_${row}`,
        componentId: "bga",
        layers: ["top"],
        center: { x, y },
        width: 0.2,
        height: 0.2,
        connectedTo: [
          `pcb_smtpad_${column}_${row}`,
          x === 0 && y === 0 ? "escape" : "foreign",
        ],
      })),
    ),
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "escape",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      vias: [
        { x: -2, y: -0.5 },
        { x: 0, y: 0.8 },
      ],
      route: [
        { x: -2, y: -1, z: 0, pcb_port_id: "start" },
        { x: -2, y: -0.5, z: 0 },
        { x: -2, y: -0.5, z: 1 },
        { x: -2, y: 0.8, z: 1 },
        { x: 0, y: 0.8, z: 1 },
        { x: 0, y: 0.8, z: 0 },
        { x: 0.2, y: 0.65, z: 0 },
        { x: 0.2, y: 0.2, z: 0 },
        { x: 0, y: 0, z: 0, pcb_port_id: "end" },
      ],
    },
    {
      connectionName: "fixed",
      traceThickness: 0.1,
      viaDiameter: 0.2,
      vias: [],
      route: [
        { x: -1.5, y: 0.45, z: 1 },
        { x: 1.5, y: 0.45, z: 1 },
      ],
    },
  ]
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: 0.1,
    viaToPadClearance: 0.05,
  })
  const drcEvaluator: DrcEvaluator = ({ hdRoutes }) =>
    engine.evaluate(
      hdRoutes!.map((route, index) => ({
        type: "pcb_trace",
        pcb_trace_id: `trace_${index}`,
        connection_name: route.connectionName,
        route: convertHdRouteToSimplifiedRoute(
          route.route,
          srj.layerCount,
          route,
        ),
      })),
    )
  return {
    srj,
    routes,
    solver: new FinePitchPadEscapeSolver({
      srj,
      routes,
      drcEvaluator,
      routeIndexByTraceId: new Map([["trace_0", 0]]),
    }),
  }
}
