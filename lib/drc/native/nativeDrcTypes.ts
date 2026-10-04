import type { NativeDrcContactWorkspace } from "./NativeDrcContactWorkspace"

export interface NativeDrcPoint {
  x: number
  y: number
}

export interface NativeDrcBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface NativeDrcWire extends NativeDrcPoint {
  route_type: "wire"
  layer: string
  width: number
  start_pcb_port_id?: string
  end_pcb_port_id?: string
}

export interface NativeDrcRouteVia extends NativeDrcPoint {
  route_type: "via"
  from_layer: string
  to_layer: string
  via_diameter?: number
  via_hole_diameter?: number
  layers?: string[]
}

/** Candidate identities are resolved by the caller's existing source resolver. */
export interface NativeDrcTrace {
  pcb_trace_id: string
  source_trace_id: string
  route: Array<NativeDrcWire | NativeDrcRouteVia>
}

/** Ordinary fixed copper; this API never inspects obstacle provenance metadata. */
export interface NativeDrcPad extends NativeDrcPoint {
  id: string
  kind: "smtpad" | "plated_hole"
  shape: "circle" | "rect"
  width: number
  height: number
  radius?: number
  rotation?: number
  layers: string[]
  portId?: string
  componentId?: string
  /** Typed-clearance query bounds include the plated drill's physical extent. */
  clearanceBounds?: NativeDrcBounds
}

export interface NativeDrcHole extends NativeDrcPoint {
  id: string
  shape: "circle" | "rect"
  diameter?: number
  width?: number
  height?: number
  componentId?: string
}

export interface NativeDrcPort extends NativeDrcPoint {
  id: string
  layers: string[]
  componentId?: string
}

export interface NativeDrcSourceTrace {
  id: string
  portIds: string[]
  netIds?: string[]
}

export interface NativeDrcBoard {
  id?: string
  outline: NativeDrcPoint[]
  edgeClearance: number
  padClearance: number
}

export interface NativeDrcConnectivity {
  areIdsConnected(id1: string, id2: string): boolean
  getNetConnectedToId(id: string): string | undefined
}

export interface NativeDrcSceneInput {
  pads: NativeDrcPad[]
  holes: NativeDrcHole[]
  ports: NativeDrcPort[]
  /** Original fixed-record order, needed when identifiers collide across kinds. */
  fixedIdentityOrder?: Array<{
    id: string
    kind: "port" | "smtpad" | "plated_hole" | "hole"
  }>
  sourceTraces: NativeDrcSourceTrace[]
  connectivity: NativeDrcConnectivity
  /** Exact caller-native logical map, compiled from ordinary source/trace links. */
  createConnectivity: (
    sourceTraces: NativeDrcSourceTrace[],
    traceLinks: Array<[string, string]>,
    viaOwnerLinks: Array<[string, string]>,
  ) => { logical: NativeDrcConnectivity; clearance: NativeDrcConnectivity }
  board?: NativeDrcBoard
  layerCount: number
  viaDiameter: number
  viaHoleDiameter: number
  allowBlindAndBuriedVias: boolean
  traceClearance: number
  viaHoleClearance: number
  holeClearance: number
}

export interface PreparedNativeDrcPad extends NativeDrcPad {
  bounds: NativeDrcBounds
  polygon: NativeDrcPoint[]
}

export interface PreparedNativeDrcHole extends NativeDrcHole {
  kind: "hole"
  bounds: NativeDrcBounds
}

export interface NativeDrcSegment {
  kind: "segment"
  order: number
  trace: NativeDrcTrace
  routeIndex: number
  layer: string
  start: NativeDrcPoint
  end: NativeDrcPoint
  width: number
  bounds: NativeDrcBounds
}

export interface NativeDrcVia extends NativeDrcPoint {
  kind: "via"
  id: string
  traceId: string
  diameter: number
  holeDiameter: number
  layers: string[]
  bounds: NativeDrcBounds
}

export interface NativeDrcError {
  type: string
  error_type: string
  message: string
  center?: NativeDrcPoint
  pcb_center?: NativeDrcPoint
  [key: string]: unknown
}

export interface NativeDrcResult {
  errors: NativeDrcError[]
  errorsWithCenters: NativeDrcError[]
  locationAwareErrors: Array<NativeDrcError & { center: NativeDrcPoint }>
}

export interface PreparedNativeDrcEvaluation {
  traces: NativeDrcTrace[]
  /** MAX-width wire/via adjacency, as required by overlap/hole rules. */
  overlapSegments: NativeDrcSegment[]
  /** Start-width wire/wire adjacency, including exact zero-length segments. */
  clearanceSegments: NativeDrcSegment[]
  /** Euclidean >1e-9 wire/wire inventory belongs to continuity separately. */
  vias: NativeDrcVia[]
  pads: PreparedNativeDrcPad[]
  scene: NativeDrcSceneInput
  contacts: NativeDrcContactWorkspace
  areConnected(id1: string, id2: string): boolean
}
