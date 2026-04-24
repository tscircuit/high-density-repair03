import type { GraphicsObject } from "graphics-debug"

export type Point = { x: number; y: number }

export type TraceId = string
export type NetId = string
export type PointId = string
export type OffBoardConnectionId = string

export type TerminalViaHint = {
  toLayer: string
  viaDiameter?: number
}

export type SingleLayerConnectionPoint = {
  x: number
  y: number
  layer: string
  pointId?: PointId
  pcb_port_id?: string
  terminalVia?: TerminalViaHint
}

export type MultiLayerConnectionPoint = {
  x: number
  y: number
  layers: string[]
  pointId?: PointId
  pcb_port_id?: string
}

export type ConnectionPoint =
  | SingleLayerConnectionPoint
  | MultiLayerConnectionPoint

export type RoutePoint = Point & {
  z: number
  pcb_port_id?: string
  insideJumperPad?: boolean
}

export type HighDensityVia = Point

export type Jumper = {
  route_type: "jumper"
  start: { x: number; y: number }
  end: { x: number; y: number }
  footprint: "0603" | "1206" | "1206x4_pair"
}

export type HighDensityRoute = {
  connectionName: string
  rootConnectionName?: string
  route: RoutePoint[]
  vias: HighDensityVia[]
  traceThickness?: number
  viaDiameter?: number
  jumpers?: Jumper[]
}

export type SimpleRouteConnection = {
  name: string
  netConnectionName?: string
  rootConnectionName?: string
  mergedConnectionNames?: string[]
  isOffBoard?: boolean
  nominalTraceWidth?: number
  pointsToConnect: ConnectionPoint[]
  externallyConnectedPointIds?: PointId[][]
}

export type SimpleRouteObstacle = {
  obstacleId?: string
  type?: "rect"
  center: Point
  width: number
  height: number
  layers: string[]
  zLayers?: number[]
  connectedTo?: Array<TraceId | NetId>
  ccwRotationDegrees?: number
  isCopperPour?: boolean
  netIsAssignable?: boolean
  offBoardConnectsTo?: Array<OffBoardConnectionId>
}

export type SimpleRouteJson = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  connections: SimpleRouteConnection[]
  obstacles: SimpleRouteObstacle[]
  layerCount: number
  minTraceWidth: number
  nominalTraceWidth?: number
  minViaDiameter?: number
  defaultObstacleMargin?: number
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
  allowJumpers?: boolean
}

export type SimplifiedPcbTrace = {
  type: "pcb_trace"
  pcb_trace_id: string
  connection_name: string
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
        start_pcb_port_id?: string
        end_pcb_port_id?: string
      }
    | {
        route_type: "via"
        x: number
        y: number
        to_layer: string
        from_layer: string
        via_diameter?: number
      }
    | {
        route_type: "jumper"
        start: { x: number; y: number }
        end: { x: number; y: number }
        footprint: "0603" | "1206" | "1206x4_pair"
        layer: string
      }
  >
}

export type SimplifiedPcbTraces = SimplifiedPcbTrace[]

export type MutableRoute = HighDensityRoute & {
  route: Array<HighDensityRoute["route"][number]>
  vias: Array<HighDensityRoute["vias"][number]>
}

export type DrcError = Record<string, any>

export type DrcSnapshot = {
  errors: DrcError[]
  count: number
  issueScore: number
  traceRouteIndexById: Map<string, number>
}

export type SolverOutput = {
  hdRoutes: HighDensityRoute[]
  drc: DrcSnapshot
}

export type SolverVisualization = GraphicsObject

export type SolverDeps = {
  cloneRoutes: (routes: HighDensityRoute[]) => MutableRoute[]
  materializeRoutes: (routes: MutableRoute[]) => HighDensityRoute[]
  getDrcSnapshot: (
    srj: SimpleRouteJson,
    routes: HighDensityRoute[],
    drcEvaluator?: DrcEvaluator,
  ) => DrcSnapshot
  getCenteredErrors: (errors: DrcError[]) => DrcError[]
  getErrorCenter: (error: DrcError) => Point | undefined
  getViaDrcIssueCount: (snapshot: DrcSnapshot) => number
  applyBroadRepulsionForces: (
    srj: SimpleRouteJson,
    routes: HighDensityRoute[],
    effort: number,
  ) => HighDensityRoute[]
  applyDrcErrorForces: (
    srj: SimpleRouteJson,
    routes: MutableRoute[],
    errors: DrcError[],
    traceRouteIndexById: Map<string, number>,
    scale: number,
  ) => boolean
  getForceScalesForEffort: (effort: number) => readonly number[]
  getMaxPassesForEffort: (effort: number) => number
  getMaxCandidateAttemptsForEffort: (effort: number) => number
  mapZToLayerName: (z: number, layerCount: number) => string
}

export type DrcEvaluatorResult =
  | DrcError[]
  | {
      errors: DrcError[]
      errorsWithCenters?: DrcError[]
    }

export type DrcEvaluator = (params: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  traces: SimplifiedPcbTraces
}) => DrcEvaluatorResult

export type GlobalDrcForceImproveSolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  effort?: number
  drcEvaluator?: DrcEvaluator
  visibleLayer?: "all" | string
  deps: SolverDeps
}
