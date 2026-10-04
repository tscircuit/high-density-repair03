import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { getViaDrillLayers } from "../utils/getViaLayers"
import { checkNativeDrcContinuity } from "./native/checkNativeDrcContinuity"
import { NativeDrcContactWorkspace } from "./native/NativeDrcContactWorkspace"
import {
  getNativeHoleClearance,
  getNativePadClearance,
  getNativeSegmentBounds,
  getNativeTracePairCenter,
  NativeDrcGrid,
  prepareNativeDrcHole,
  prepareNativeDrcPad,
  queryNativeDrcGrids,
} from "./native/nativeDrcGeometry"
import type {
  NativeDrcBounds,
  NativeDrcError,
  NativeDrcResult,
  NativeDrcSceneInput,
  NativeDrcSegment,
  NativeDrcSourceTrace,
  NativeDrcTrace,
  NativeDrcVia,
  NativeDrcWire,
  PreparedNativeDrcEvaluation,
  PreparedNativeDrcHole,
  PreparedNativeDrcPad,
} from "./native/nativeDrcTypes"

export type {
  NativeDrcSceneInput,
  NativeDrcTrace,
  NativeDrcResult,
} from "./native/nativeDrcTypes"

export interface PreparedNativeDrcOptions {
  includeTraceContinuity?: boolean
  includeTypedTraceClearance?: boolean
  sourceTraces?: NativeDrcSourceTrace[]
  traceClearance?: number
  contacts?: NativeDrcContactWorkspace
}

type Collidable =
  | NativeDrcSegment
  | PreparedNativeDrcPad
  | PreparedNativeDrcHole
  | NativeDrcVia

function isSegment(object: Collidable): object is NativeDrcSegment {
  return "kind" in object && object.kind === "segment"
}

function getTracePortIds(traces: NativeDrcTrace[]): string[] {
  const portIds = new Set<string>()
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      if (point.start_pcb_port_id) portIds.add(point.start_pcb_port_id)
      if (point.end_pcb_port_id) portIds.add(point.end_pcb_port_id)
    }
  }
  return [...portIds]
}

function formatClearance(value: number): string {
  const rounded = Math.round(value * 1e3) / 1e3
  return `${Number(rounded.toFixed(3))}mm`
}

function getTraceName(trace: NativeDrcTrace): string {
  const ports = trace.route
    .flatMap((point) =>
      point.route_type === "wire"
        ? [point.start_pcb_port_id, point.end_pcb_port_id]
        : [],
    )
    .filter(Boolean)
  return ports.length
    ? `trace[${ports.map((port) => `port[${port}]`).join(", ")}]`
    : `trace[${trace.pcb_trace_id}]`
}

function getObstacleName(
  obstacle: PreparedNativeDrcPad | PreparedNativeDrcHole | NativeDrcVia,
): string {
  if (obstacle.kind === "via") return `pcb_via[#${obstacle.id}]`
  if (obstacle.kind === "hole") return `pcb_hole[#${obstacle.id}]`
  if (obstacle.kind === "plated_hole") return `pcb_plated_hole[#${obstacle.id}]`
  return obstacle.portId
    ? `pcb_port[#${obstacle.portId}]`
    : `smtpad[${obstacle.id}]`
}

/**
 * Fixed ordinary geometry is prepared once at the caller's input boundary.
 * Candidate evaluation consumes native routes, never CircuitJSON or metadata.
 * Existing AutoroutingDrcEngine remains the independent repair objective.
 */
export class PreparedNativeDrcScene {
  readonly input: NativeDrcSceneInput
  readonly pads: PreparedNativeDrcPad[]
  readonly holes: PreparedNativeDrcHole[]
  private readonly padGrid: NativeDrcGrid<Collidable>
  private readonly clearancePadGrid: NativeDrcGrid<Collidable>
  private readonly holeGrid: NativeDrcGrid<Collidable>
  private readonly overlapHoleGrid: NativeDrcGrid<Collidable>
  private readonly fixedNames = new Map<string, string>()
  private readonly namesByEvaluation = new WeakMap<
    PreparedNativeDrcEvaluation,
    Map<string, string>
  >()

  constructor(input: NativeDrcSceneInput) {
    for (const [name, value] of Object.entries({
      traceClearance: input.traceClearance,
      viaHoleClearance: input.viaHoleClearance,
      holeClearance: input.holeClearance,
      viaDiameter: input.viaDiameter,
      viaHoleDiameter: input.viaHoleDiameter,
    })) {
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`Invalid native DRC ${name}: ${value}`)
    }
    if (!Number.isInteger(input.layerCount) || input.layerCount < 1)
      throw new Error(`Invalid native DRC layer count: ${input.layerCount}`)
    if (typeof input.createConnectivity !== "function")
      throw new Error(
        "Native DRC scene requires its caller's logical connectivity factory",
      )
    for (const point of [
      ...input.ports,
      ...input.pads,
      ...input.holes,
      ...(input.board?.outline ?? []),
    ])
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error("Non-finite fixed native DRC coordinate")
    for (const pad of input.pads) {
      if (
        !Number.isFinite(pad.width) ||
        !Number.isFinite(pad.height) ||
        pad.width <= 0 ||
        pad.height <= 0 ||
        (pad.shape === "circle" &&
          (!Number.isFinite(pad.radius) || pad.radius! <= 0)) ||
        (pad.rotation !== undefined && !Number.isFinite(pad.rotation))
      )
        throw new Error(`Invalid native DRC pad dimensions: ${pad.id}`)
      if (
        pad.layers.length === 0 ||
        (pad.kind === "smtpad" && pad.layers.length !== 1)
      )
        throw new Error(`Invalid native DRC pad layers: ${pad.id}`)
    }
    for (const hole of input.holes) {
      const dimensions =
        hole.shape === "circle" ? [hole.diameter] : [hole.width, hole.height]
      if (dimensions.some((value) => !Number.isFinite(value) || value! <= 0))
        throw new Error(`Invalid native DRC hole dimensions: ${hole.id}`)
    }
    if (
      input.board &&
      (input.board.outline.length < 3 ||
        !Number.isFinite(input.board.edgeClearance) ||
        input.board.edgeClearance < 0 ||
        !Number.isFinite(input.board.padClearance) ||
        input.board.padClearance < 0)
    )
      throw new Error("Invalid native DRC board rules or outline")
    this.input = input
    // The reference lists every SMT pad before every plated hole.
    this.pads = [
      ...input.pads.filter((pad) => pad.kind === "smtpad"),
      ...input.pads.filter((pad) => pad.kind === "plated_hole"),
    ].map(prepareNativeDrcPad)
    this.holes = input.holes.map(prepareNativeDrcHole)
    const identityOrder = input.fixedIdentityOrder ?? [
      ...input.ports.map((port) => ({ id: port.id, kind: "port" as const })),
      ...input.pads.map((pad) => ({ id: pad.id, kind: pad.kind })),
      ...input.holes.map((hole) => ({ id: hole.id, kind: "hole" as const })),
    ]
    for (const identity of identityOrder) {
      if (this.fixedNames.has(identity.id)) continue
      if (identity.kind === "port") {
        if (!input.ports.some((port) => port.id === identity.id))
          throw new Error(`Unknown native DRC identity port: ${identity.id}`)
        this.fixedNames.set(identity.id, `pcb_port[#${identity.id}]`)
      } else {
        const object =
          identity.kind === "hole"
            ? this.holes.find((hole) => hole.id === identity.id)
            : this.pads.find(
                (pad) => pad.kind === identity.kind && pad.id === identity.id,
              )
        if (!object)
          throw new Error(`Unknown native DRC fixed identity: ${identity.id}`)
        this.fixedNames.set(identity.id, getObstacleName(object))
      }
    }
    this.padGrid = new NativeDrcGrid<Collidable>(
      this.pads,
      (object) => object.bounds,
    )
    this.clearancePadGrid = new NativeDrcGrid<Collidable>(
      this.pads,
      (object) =>
        (object as PreparedNativeDrcPad).clearanceBounds ?? object.bounds,
    )
    this.holeGrid = new NativeDrcGrid<Collidable>(
      this.holes,
      (object) => object.bounds,
    )
    // The reference overlap broad phase indexes a rectangular NP hole at its
    // center; its dedicated hole-clearance rule indexes the complete rectangle.
    this.overlapHoleGrid = new NativeDrcGrid<Collidable>(
      this.holes,
      (object) => {
        const hole = object as PreparedNativeDrcHole
        return hole.shape === "rect"
          ? { minX: hole.x, minY: hole.y, maxX: hole.x, maxY: hole.y }
          : hole.bounds
      },
    )
  }

  prepare(
    traces: NativeDrcTrace[],
    options: PreparedNativeDrcOptions = {},
  ): PreparedNativeDrcEvaluation {
    if (
      options.traceClearance !== undefined &&
      (!Number.isFinite(options.traceClearance) || options.traceClearance < 0)
    )
      throw new Error("Invalid native DRC candidate trace clearance")
    const preparedTraces = traces.map((trace) => ({
      ...trace,
      route: trace.route.map((point) => ({ ...point })),
    }))
    const overlapSegments: NativeDrcSegment[] = []
    const clearanceSegments: NativeDrcSegment[] = []
    const vias: NativeDrcVia[] = []
    const viaByLocation = new Set<string>()
    for (const trace of preparedTraces) {
      for (let i = 0; i < trace.route.length; i++) {
        const point = trace.route[i]!
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
          throw new Error(`Non-finite route point in ${trace.pcb_trace_id}`)
        if (point.route_type === "wire") {
          if (!Number.isFinite(point.width) || point.width <= 0)
            throw new Error(`Invalid route width in ${trace.pcb_trace_id}`)
          if (i === 0 && !point.start_pcb_port_id)
            point.start_pcb_port_id = this.findPortAtEndpoint(point)
          if (i === trace.route.length - 1 && !point.end_pcb_port_id)
            point.end_pcb_port_id = this.findPortAtEndpoint(point)
        } else {
          const location = `${point.x},${point.y},${point.from_layer},${point.to_layer}`
          if (!viaByLocation.has(location)) {
            viaByLocation.add(location)
            const diameter = point.via_diameter ?? this.input.viaDiameter
            const holeDiameter =
              point.via_hole_diameter ?? this.input.viaHoleDiameter
            if (
              !Number.isFinite(diameter) ||
              diameter <= 0 ||
              !Number.isFinite(holeDiameter) ||
              holeDiameter < 0
            )
              throw new Error(`Invalid via dimensions in ${trace.pcb_trace_id}`)
            vias.push({
              kind: "via",
              id: `via_${vias.length}`,
              traceId: trace.pcb_trace_id,
              x: point.x,
              y: point.y,
              diameter,
              holeDiameter,
              layers: getViaDrillLayers(
                point,
                this.input.layerCount,
                this.input.allowBlindAndBuriedVias,
              ),
              bounds: {
                minX: point.x - diameter / 2,
                minY: point.y - diameter / 2,
                maxX: point.x + diameter / 2,
                maxY: point.y + diameter / 2,
              },
            })
          }
        }
        if (i === trace.route.length - 1) continue
        const end = trace.route[i + 1]!
        if (point.route_type !== "wire" && end.route_type !== "wire") continue
        if (
          point.route_type === "wire" &&
          end.route_type === "wire" &&
          point.layer !== end.layer
        )
          continue
        const wire =
          point.route_type === "wire" ? point : (end as NativeDrcWire)
        const startPoint = { x: point.x, y: point.y }
        const endPoint = { x: end.x, y: end.y }
        const segment: NativeDrcSegment = {
          kind: "segment",
          order: overlapSegments.length,
          trace,
          routeIndex: i,
          layer: wire.layer,
          start: startPoint,
          end: endPoint,
          width: Math.max(
            point.route_type === "wire" ? point.width : 0,
            end.route_type === "wire" ? end.width : 0,
          ),
          bounds: getNativeSegmentBounds(startPoint, endPoint),
        }
        overlapSegments.push(segment)
        if (point.route_type === "wire" && end.route_type === "wire")
          clearanceSegments.push({
            ...segment,
            order: clearanceSegments.length,
            width: point.width,
          })
      }
    }
    const sourceTraces = options.sourceTraces ?? this.input.sourceTraces
    const maps = this.input.createConnectivity(
      sourceTraces,
      preparedTraces
        .filter((trace) => Boolean(trace.source_trace_id))
        .map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
      vias.map((via) => [via.id, via.traceId]),
    )
    const scene = {
      ...this.input,
      sourceTraces,
      connectivity: maps.logical,
      traceClearance: options.traceClearance ?? this.input.traceClearance,
    }
    return {
      traces: preparedTraces,
      overlapSegments,
      clearanceSegments,
      vias,
      pads: this.pads,
      scene,
      contacts: options.contacts ?? new NativeDrcContactWorkspace(),
      areConnected: (id1, id2): boolean =>
        maps.clearance.areIdsConnected(id1, id2),
    }
  }

  private findPortAtEndpoint(point: NativeDrcWire): string | undefined {
    const direct = this.input.ports.find(
      (port) =>
        port.layers.includes(point.layer) &&
        Math.sqrt((port.x - point.x) ** 2 + (port.y - point.y) ** 2) < 0.01,
    )
    if (direct) return direct.id
    const pad = this.pads.find(
      (pad) =>
        pad.kind === "smtpad" &&
        pad.layers.includes(point.layer) &&
        (pad.shape === "circle"
          ? Math.sqrt((point.x - pad.x) ** 2 + (point.y - pad.y) ** 2) <
            pad.radius!
          : pad.rotation === undefined &&
            Math.abs(point.x - pad.x) < pad.width / 2 + point.width / 2 &&
            Math.abs(point.y - pad.y) < pad.height / 2 + point.width / 2),
    )
    return pad?.portId
  }

  evaluate(
    traces: NativeDrcTrace[],
    options: PreparedNativeDrcOptions = {},
  ): NativeDrcResult {
    const evaluation = this.prepare(traces, options)
    return this.evaluatePrepared(evaluation, options)
  }

  private getElementName(
    evaluation: PreparedNativeDrcEvaluation,
    id: string,
  ): string {
    let names = this.namesByEvaluation.get(evaluation)
    if (!names) {
      names = new Map()
      const add = (identity: string, name: string): void => {
        if (!names!.has(identity)) names!.set(identity, name)
      }
      for (const source of evaluation.scene.sourceTraces)
        add(source.id, `source_trace[#${source.id}]`)
      for (const [identity, name] of this.fixedNames) add(identity, name)
      for (const via of evaluation.vias) add(via.id, getObstacleName(via))
      for (const trace of evaluation.traces)
        add(trace.pcb_trace_id, getTraceName(trace))
      if (this.input.board)
        add(
          this.input.board.id ?? "__autorouting_board__",
          `pcb_board[#${this.input.board.id ?? "__autorouting_board__"}]`,
        )
      this.namesByEvaluation.set(evaluation, names)
    }
    const name = names.get(id)
    if (name === undefined)
      throw new Error(`Unknown native DRC readable identity: ${id}`)
    return name
  }

  evaluatePrepared(
    evaluation: PreparedNativeDrcEvaluation,
    options: PreparedNativeDrcOptions = {},
  ): NativeDrcResult {
    if (evaluation.pads !== this.pads)
      throw new Error(
        "Prepared native DRC candidate belongs to a different scene",
      )
    const errors = [
      ...this.checkOverlaps(evaluation),
      ...this.checkBoard(evaluation),
      ...(options.includeTraceContinuity === false
        ? []
        : checkNativeDrcContinuity(evaluation)),
      ...(options.includeTypedTraceClearance === false
        ? []
        : this.checkTypedClearance(evaluation, "via")),
      ...(options.includeTypedTraceClearance === false
        ? []
        : this.checkTypedClearance(evaluation, "pad")),
      ...this.checkHoles(evaluation),
      ...this.checkViaPairs(evaluation, true),
      ...this.checkViaPairs(evaluation, false),
    ]
    const viaById = new Map(evaluation.vias.map((via) => [via.id, via]))
    const errorsWithCenters = errors.map((error) => {
      if (
        error.type === "pcb_via_trace_clearance_error" &&
        typeof error.pcb_via_id === "string"
      ) {
        const via = viaById.get(error.pcb_via_id)
        if (!via) throw new Error(`Unknown error via ${error.pcb_via_id}`)
        return { ...error, center: { x: via.x, y: via.y } }
      }
      if (error.center) return error
      if (error.pcb_center) return { ...error, center: error.pcb_center }
      return error
    })
    return {
      errors,
      errorsWithCenters,
      locationAwareErrors: errorsWithCenters.filter(
        (
          error,
        ): error is NativeDrcError & { center: { x: number; y: number } } =>
          Boolean(error.center),
      ),
    }
  }

  private checkOverlaps(
    evaluation: PreparedNativeDrcEvaluation,
  ): NativeDrcError[] {
    const errors: NativeDrcError[] = []
    const ids = new Set<string>()
    const segmentGrid = new NativeDrcGrid<Collidable>(
      evaluation.overlapSegments,
      (object) => object.bounds,
    )
    const viaGrid = new NativeDrcGrid<Collidable>(
      evaluation.vias,
      (object) => object.bounds,
    )
    for (const a of evaluation.overlapSegments) {
      if (a.start.x === a.end.x && a.start.y === a.end.y) continue
      for (const object of queryNativeDrcGrids(
        a.bounds,
        evaluation.scene.traceClearance + a.width / 2,
        [segmentGrid, this.padGrid, this.overlapHoleGrid, viaGrid],
      )) {
        if (isSegment(object)) {
          const b = object
          if (
            a.layer !== b.layer ||
            evaluation.areConnected(a.trace.pcb_trace_id, b.trace.pcb_trace_id)
          )
            continue
          const gap =
            evaluation.contacts.segmentDistance(
              a.start,
              a.end,
              b.start,
              b.end,
            ) -
            a.width / 2 -
            b.width / 2
          if (gap > evaluation.scene.traceClearance - 0.005) continue
          const id = `overlap_${a.trace.pcb_trace_id}_${b.trace.pcb_trace_id}`
          if (
            ids.has(id) ||
            ids.has(`overlap_${b.trace.pcb_trace_id}_${a.trace.pcb_trace_id}`)
          )
            continue
          ids.add(id)
          errors.push({
            type: "pcb_trace_error",
            error_type: "pcb_trace_error",
            message: this.overlapMessage(
              this.getElementName(evaluation, a.trace.pcb_trace_id),
              this.getElementName(evaluation, b.trace.pcb_trace_id),
              gap,
            ),
            pcb_trace_id: a.trace.pcb_trace_id,
            source_trace_id: "",
            pcb_trace_error_id: id,
            pcb_component_ids: [],
            center: getNativeTracePairCenter(a, b),
            pcb_port_ids: getTracePortIds([a.trace, b.trace]),
          })
          continue
        }
        if (object.kind !== "hole" && !object.layers.includes(a.layer)) continue
        const isVia = object.kind === "via"
        const isHole = object.kind === "hole"
        if (
          evaluation.areConnected(
            a.trace.pcb_trace_id,
            isVia ? object.traceId : object.id,
          )
        )
          continue
        const { gap, center } = isHole
          ? getNativeHoleClearance(a, object)
          : getNativePadClearance(a, object, evaluation.contacts)
        if (gap > 0) continue
        const id = `overlap_${a.trace.pcb_trace_id}_${object.id}`
        if (ids.has(id)) continue
        ids.add(id)
        const type = isHole
          ? "pcb_hole"
          : isVia
            ? "pcb_via"
            : object.kind === "smtpad"
              ? "pcb_smtpad"
              : "pcb_plated_hole"
        const portIds = getTracePortIds([a.trace])
        if (!isHole && !isVia && object.portId) portIds.push(object.portId)
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          message: this.overlapMessage(
            this.getElementName(evaluation, a.trace.pcb_trace_id),
            `${type} "${this.getElementName(evaluation, object.id)}"`,
            gap,
          ),
          pcb_trace_id: a.trace.pcb_trace_id,
          center,
          source_trace_id: isHole ? a.trace.source_trace_id : "",
          pcb_trace_error_id: id,
          pcb_component_ids:
            !isVia && object.componentId ? [object.componentId] : [],
          pcb_port_ids: portIds,
        })
      }
    }
    return errors
  }

  private overlapMessage(
    traceId: string,
    otherId: string,
    gap: number,
  ): string {
    return gap <= 0
      ? `PCB trace ${traceId} overlaps with ${otherId} (accidental contact)`
      : `PCB trace ${traceId} is too close to ${otherId} (gap: ${gap.toFixed(3)}mm)`
  }

  private checkTypedClearance(
    evaluation: PreparedNativeDrcEvaluation,
    kind: "pad" | "via",
  ): NativeDrcError[] {
    const errors = new Map<string, { error: NativeDrcError; gap: number }>()
    const overlapping = new Set<string>()
    const checkPair = (
      segment: NativeDrcSegment,
      obstacle: PreparedNativeDrcPad | NativeDrcVia,
    ): void => {
      if (
        !obstacle.layers.includes(segment.layer) ||
        evaluation.areConnected(segment.trace.pcb_trace_id, obstacle.id)
      )
        return
      const pairId = `${obstacle.id}_${segment.trace.pcb_trace_id}`
      const { gap, center } = getNativePadClearance(
        segment,
        obstacle,
        evaluation.contacts,
      )
      if (gap <= 0) {
        errors.delete(pairId)
        overlapping.add(pairId)
        return
      }
      if (
        overlapping.has(pairId) ||
        gap + 0.005 >= evaluation.scene.traceClearance
      )
        return
      const existing = errors.get(pairId)
      if (existing && gap >= existing.gap) return
      const type = `pcb_${kind}_trace_clearance_error`
      const error: NativeDrcError = {
        type,
        [`pcb_${kind}_trace_clearance_error_id`]: `${kind}_trace_clearance_${pairId}`,
        error_type: type,
        message: `${kind === "pad" ? "Pad" : "Via"} ${this.getElementName(evaluation, obstacle.id)} and trace ${this.getElementName(evaluation, segment.trace.pcb_trace_id)} are too close (clearance: ${formatClearance(gap)}, minimum: ${formatClearance(evaluation.scene.traceClearance)})`,
        [`pcb_${kind}_id`]: obstacle.id,
        pcb_trace_id: segment.trace.pcb_trace_id,
        minimum_clearance: evaluation.scene.traceClearance,
        actual_clearance: gap,
        center,
      }
      errors.set(pairId, { error, gap })
    }
    if (kind === "via") {
      const segments = new NativeDrcGrid(
        evaluation.clearanceSegments,
        (segment) => ({
          minX: segment.bounds.minX - segment.width / 2,
          minY: segment.bounds.minY - segment.width / 2,
          maxX: segment.bounds.maxX + segment.width / 2,
          maxY: segment.bounds.maxY + segment.width / 2,
        }),
      )
      for (const via of evaluation.vias) {
        // Reference via-major/segment-major ordering, independent of grid order.
        const candidates = segments
          .query(via.bounds, evaluation.scene.traceClearance)
          .sort((a, b) => a.order - b.order)
        for (const segment of candidates) checkPair(segment, via)
      }
    } else {
      for (const segment of evaluation.clearanceSegments)
        for (const pad of this.clearancePadGrid.query(
          segment.bounds,
          evaluation.scene.traceClearance + segment.width / 2,
          (pad) => (pad as PreparedNativeDrcPad).id,
        ))
          checkPair(segment, pad as PreparedNativeDrcPad)
    }
    return [...errors.values()].map(({ error }) => error)
  }

  private checkBoard(
    evaluation: PreparedNativeDrcEvaluation,
  ): NativeDrcError[] {
    const board = this.input.board
    if (!board) return []
    const errors: NativeDrcError[] = []
    for (const trace of evaluation.traces) {
      for (let i = 0; i < trace.route.length - 1; i++) {
        const a = trace.route[i]!
        const b = trace.route[i + 1]!
        if (a.route_type !== "wire" || b.route_type !== "wire") continue
        let minDistance = Infinity
        for (let j = 0; j < board.outline.length; j++)
          minDistance = Math.min(
            minDistance,
            segmentToSegmentMinDistance(
              a,
              b,
              board.outline[j]!,
              board.outline[(j + 1) % board.outline.length]!,
            ),
          )
        const minimumDistance = a.width / 2 + board.edgeClearance
        if (minDistance >= minimumDistance) continue
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_error_id: `trace_too_close_to_board_${trace.pcb_trace_id}_segment_${i}`,
          message: `Trace too close to board edge (${minDistance.toFixed(3)}mm < ${minimumDistance.toFixed(3)}mm required, margin: ${board.edgeClearance}mm)`,
          pcb_trace_id: trace.pcb_trace_id,
          source_trace_id: trace.source_trace_id || "",
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          pcb_component_ids: [],
          pcb_port_ids: [],
        })
      }
    }
    return errors
  }

  private checkHoles(
    evaluation: PreparedNativeDrcEvaluation,
  ): NativeDrcError[] {
    const errors = new Map<string, { error: NativeDrcError; gap: number }>()
    const overlapping = new Set<string>()
    for (const segment of evaluation.overlapSegments) {
      for (const object of this.holeGrid.query(
        segment.bounds,
        this.input.holeClearance + segment.width / 2,
      )) {
        const hole = object as PreparedNativeDrcHole
        const { gap, center } = getNativeHoleClearance(segment, hole)
        const pairId = `${segment.trace.pcb_trace_id}_${hole.id}`
        if (gap <= 0) {
          errors.delete(pairId)
          overlapping.add(pairId)
          continue
        }
        if (
          overlapping.has(pairId) ||
          gap + 1e-6 >= this.input.holeClearance ||
          (errors.get(pairId)?.gap ?? Infinity) <= gap
        )
          continue
        errors.set(pairId, {
          gap,
          error: {
            type: "pcb_trace_error",
            error_type: "pcb_trace_error",
            pcb_trace_error_id: `overlap_${pairId}`,
            pcb_trace_id: segment.trace.pcb_trace_id,
            source_trace_id: segment.trace.source_trace_id,
            pcb_component_ids: hole.componentId ? [hole.componentId] : [],
            pcb_port_ids: [],
            center,
            message: `Trace ${segment.trace.pcb_trace_id} is too close to non-plated hole ${hole.id} (gap: ${gap.toFixed(6)}mm, required: ${this.input.holeClearance}mm)`,
          },
        })
      }
    }
    return [...errors.values()].map(({ error }) => error)
  }

  private checkViaPairs(
    evaluation: PreparedNativeDrcEvaluation,
    sameNet: boolean,
  ): NativeDrcError[] {
    const errors: NativeDrcError[] = []
    const clearance = Math.max(this.input.viaHoleClearance, 0.1)
    const copperClearance = this.input.board?.padClearance ?? 0.1
    const maxRadius = evaluation.vias.reduce(
      (radius, via) => Math.max(radius, via.diameter / 2, via.holeDiameter / 2),
      0,
    )
    const grid = new NativeDrcGrid(evaluation.vias, (via) => via.bounds)
    const order = new Map(evaluation.vias.map((via, index) => [via, index]))
    for (let i = 0; i < evaluation.vias.length; i++) {
      const a = evaluation.vias[i]!
      const bounds: NativeDrcBounds = {
        minX: a.x,
        minY: a.y,
        maxX: a.x,
        maxY: a.y,
      }
      const candidates = grid
        .query(
          bounds,
          Math.max(clearance, copperClearance) +
            Math.max(a.diameter, a.holeDiameter) / 2 +
            maxRadius,
        )
        .filter((b) => order.get(b)! > i)
        .sort((a, b) => order.get(a)! - order.get(b)!)
      for (const b of candidates) {
        if (evaluation.areConnected(a.id, b.id) !== sameNet) continue
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (sameNet && distance <= 0.005) continue
        let gap = distance - a.holeDiameter / 2 - b.holeDiameter / 2
        let minimumClearance = clearance
        if (gap + 0.005 >= minimumClearance) {
          if (sameNet || !a.layers.some((layer) => b.layers.includes(layer)))
            continue
          gap = distance - a.diameter / 2 - b.diameter / 2
          minimumClearance = copperClearance
          if (gap >= 0 && gap + 0.005 >= minimumClearance) continue
        }
        const pairId = [a.id, b.id].sort().join("_")
        errors.push({
          type: "pcb_via_clearance_error",
          pcb_error_id: `${sameNet ? "same_net" : "different_net"}_vias_close_${pairId}`,
          message: `Vias ${this.getElementName(evaluation, a.id)} and ${this.getElementName(evaluation, b.id)}${sameNet ? "" : " from different nets"} are too close together (gap: ${gap.toFixed(3)}mm)`,
          error_type: "pcb_via_clearance_error",
          pcb_via_ids: [a.id, b.id],
          minimum_clearance: minimumClearance,
          actual_clearance: gap,
          pcb_center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        })
      }
    }
    return errors
  }
}
