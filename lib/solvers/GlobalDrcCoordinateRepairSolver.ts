import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, type AutoroutingDrcError } from "../drc"
import type { SimpleRouteJson, SimplifiedPcbTrace, SimplifiedPcbTraces } from "../types"
import { BaseSolver } from "./BaseSolver"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type MovablePoint = Exclude<RoutePoint, { route_type: "jumper" }>
type CoordinateGroup = {
  traceId: string
  points: MovablePoint[]
  via: boolean
  radius: number
}
type Params = {
  connMap?: ConnectivityMap
  srj: SimpleRouteJson
  routedTraces: SimplifiedPcbTraces
}
type Phase = "vias" | "gradient" | "polish" | "done"

const getDeficitEnergy = (errors: AutoroutingDrcError[]): number => {
  let energy = 0
  for (const error of errors) {
    const minimum = Number(error.minimum_clearance)
    const actual = Number(error.actual_clearance)
    if (!Number.isFinite(minimum) || !Number.isFinite(actual)) {
      throw new Error("Coordinate repair requires numeric clearance metadata")
    }
    energy += Math.max(0, minimum - actual) ** 2
  }
  return energy
}

/** Bounded, coupled coordinate repair; terminals and fixed input copper never move. */
export class GlobalDrcCoordinateRepairSolver extends BaseSolver {
  readonly routes: SimplifiedPcbTraces
  readonly engine: AutoroutingDrcEngine
  readonly contactEngine: AutoroutingDrcEngine
  readonly groups: CoordinateGroup[] = []
  errors: AutoroutingDrcError[]
  private phase: Phase = "vias"
  private queue: CoordinateGroup[] = []
  private cursor = 0
  private pass = 0
  private changed = false
  private cycle = 0
  private gradientIteration = 0
  private refined = false

  constructor(readonly params: Params) {
    super()
    this.MAX_ITERATIONS = 100000
    this.routes = structuredClone(params.routedTraces)
    const options = {
      connMap: params.connMap,
      traceClearance: 0.1,
      viaClearance: 0.1,
      traceToPadClearance: params.srj.minTraceToPadEdgeClearance ?? 0.1,
      viaToPadClearance: params.srj.minViaEdgeToPadEdgeClearance ?? 0.1,
      includeTraceViaOwnerMetadata: true,
      disallowViaInSmtPad: true,
    }
    this.engine = new AutoroutingDrcEngine(params.srj, options)
    this.contactEngine = new AutoroutingDrcEngine(params.srj, {
      ...options,
      traceClearance: options.traceClearance + 0.005,
      viaClearance: options.viaClearance + 0.005,
      traceToPadClearance: options.traceToPadClearance + 0.005,
      viaToPadClearance: options.viaToPadClearance + 0.005,
    })
    this.simplifyRoutes()
    this.buildCoordinateGroups()
    this.errors = this.evaluate()
  }

  private buildCoordinateGroups(): void {
    this.groups.length = 0
    for (const trace of this.routes) {
      const visited = new Set<RoutePoint>()
      for (const point of trace.route) {
        if (point.route_type === "jumper" || visited.has(point)) continue
        const points = trace.route.filter((other): other is MovablePoint =>
          other.route_type !== "jumper" &&
          Math.hypot(other.x - point.x, other.y - point.y) < 1e-7,
        )
        points.forEach((other) => visited.add(other))
        if (trace.route.some((other) => other.route_type === "jumper" &&
          [other.start, other.end].some((terminal) =>
            Math.hypot(terminal.x - point.x, terminal.y - point.y) < 1e-7))) continue
        if (points.some((other) => other === trace.route[0] ||
          other === trace.route.at(-1) ||
          (other.route_type === "wire" &&
            (other.start_pcb_port_id || other.end_pcb_port_id)))) continue
        this.groups.push({
          traceId: trace.pcb_trace_id,
          points,
          via: points.some((other) => other.route_type === "via"),
          radius: Math.max(...points.map((other) => other.route_type === "via"
            ? (other.via_diameter ?? this.params.srj.minViaDiameter ?? 0.3) / 2
            : other.width / 2)),
        })
      }
    }
  }

  private simplifyRoutes(backwardOnly = false): void {
    let errors = this.evaluate()
    let score = errors.length * 100 + Math.sqrt(getDeficitEnergy(errors))
    let intersections = this.engine.lastRunStats.traceIntersectionCount
    const involvedIds = new Set(errors.flatMap((error) => [
      error.pcb_trace_id,
      ...(Array.isArray(error.pcb_trace_ids) ? error.pcb_trace_ids : []),
    ]))
    const anchors = [...(this.params.srj.traces ?? []), ...this.routes].flatMap((trace) =>
      trace.route.flatMap((point, index) => {
        if (point.route_type === "jumper") return [point.start, point.end]
        if (point.route_type === "via" || index === 0 || index === trace.route.length - 1 ||
          point.start_pcb_port_id || point.end_pcb_port_id) return [point]
        return []
      }),
    )
    for (const trace of this.routes) {
      if (!involvedIds.has(trace.pcb_trace_id)) continue
      for (let index = 1; index < trace.route.length - 1; index++) {
        const previous = trace.route[index - 1]!
        const point = trace.route[index]!
        const next = trace.route[index + 1]!
        if (previous.route_type !== "wire" || point.route_type !== "wire" ||
          next.route_type !== "wire" || previous.layer !== point.layer ||
          next.layer !== point.layer || previous.width !== point.width ||
          next.width !== point.width || point.start_pcb_port_id || point.end_pcb_port_id) continue
        if (anchors.some((anchor) =>
          Math.hypot(anchor.x - point.x, anchor.y - point.y) < 1e-7)) continue
        const ax = point.x - previous.x
        const ay = point.y - previous.y
        const bx = next.x - point.x
        const by = next.y - point.y
        if (backwardOnly && ax * bx + ay * by >= 0) continue
        trace.route.splice(index, 1)
        const candidateErrors = this.evaluate()
        const candidateScore = candidateErrors.length * 100 + Math.sqrt(getDeficitEnergy(candidateErrors))
        const candidateIntersections = this.engine.lastRunStats.traceIntersectionCount
        if (candidateScore <= score + 1e-9 && candidateIntersections <= intersections) {
          errors = candidateErrors
          score = candidateScore
          intersections = candidateIntersections
          index--
        } else {
          trace.route.splice(index, 0, point)
        }
      }
    }
  }

  private refineRoutesNearErrors(): boolean {
    let addedPoints = 0
    for (const trace of this.routes) {
      const centers = this.errors.filter((error) => error.pcb_trace_id === trace.pcb_trace_id ||
        (Array.isArray(error.pcb_trace_ids) && error.pcb_trace_ids.includes(trace.pcb_trace_id)))
        .flatMap((error) => error.center ? [error.center] : [])
      for (let index = 0; index < trace.route.length - 1; index++) {
        const start = trace.route[index]!
        const end = trace.route[index + 1]!
        if (start.route_type !== "wire" || end.route_type !== "wire" ||
          start.layer !== end.layer || start.width !== end.width) continue
        const dx = end.x - start.x
        const dy = end.y - start.y
        const length = Math.hypot(dx, dy)
        if (length <= 0.3 || !centers.some((center) => {
          const fraction = Math.max(0, Math.min(1,
            ((center.x - start.x) * dx + (center.y - start.y) * dy) / (length * length)))
          return Math.hypot(center.x - start.x - dx * fraction,
            center.y - start.y - dy * fraction) < 1.2
        })) continue
        const divisions = Math.min(24, Math.ceil(length / 0.3))
        const points = Array.from({ length: divisions - 1 }, (_, pointIndex) => ({
          ...start,
          x: start.x + dx * (pointIndex + 1) / divisions,
          y: start.y + dy * (pointIndex + 1) / divisions,
          start_pcb_port_id: undefined,
          end_pcb_port_id: undefined,
        }))
        trace.route.splice(index + 1, 0, ...points)
        index += points.length
        addedPoints += points.length
      }
    }
    this.stats.refinementPoints = addedPoints
    return addedPoints > 0
  }

  private evaluate(contacts = false): AutoroutingDrcError[] {
    const traces = [...(this.params.srj.traces ?? []), ...this.routes]
    return contacts
      ? this.contactEngine.evaluateContacts(traces).errors
      : this.engine.evaluate(traces).errors
  }

  private set(group: CoordinateGroup, x: number, y: number): void {
    for (const point of group.points) {
      point.x = x
      point.y = y
    }
  }

  private inside(group: CoordinateGroup, x: number, y: number): boolean {
    const bounds = this.params.srj.bounds
    return x - group.radius >= bounds.minX && x + group.radius <= bounds.maxX &&
      y - group.radius >= bounds.minY && y + group.radius <= bounds.maxY
  }

  private selectGroups(errors: AutoroutingDrcError[], neighbors: boolean): CoordinateGroup[] {
    return this.groups.filter((group) => errors.some((error) => {
      const involved = error.pcb_trace_id === group.traceId ||
        (Array.isArray(error.pcb_trace_ids) && error.pcb_trace_ids.includes(group.traceId))
      const center = error.center
      return (neighbors || involved) && center !== undefined &&
        Math.hypot(center.x - group.points[0]!.x, center.y - group.points[0]!.y) < (neighbors ? 1.2 : 2)
    }))
  }

  private scan(group: CoordinateGroup): boolean {
    const { x, y } = group.points[0]!
    let bestX = x
    let bestY = y
    let bestErrors = this.errors
    this.evaluate()
    let bestIntersections = this.engine.lastRunStats.traceIntersectionCount
    let bestScore = this.errors.length * 100 + Math.sqrt(getDeficitEnergy(this.errors))
    const angles = this.phase === "vias" ? 32 : 16
    // A via can be trapped between a group of same-net pads; escaping the
    // entire pad cluster may require a larger move than adjusting a bend.
    const radii = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1,
      ...(group.via ? [1.5, 2] : [])]
    for (const radius of radii) {
      for (let angle = 0; angle < angles; angle++) {
        const cx = x + radius * Math.cos(angle * 2 * Math.PI / angles)
        const cy = y + radius * Math.sin(angle * 2 * Math.PI / angles)
        if (!this.inside(group, cx, cy)) continue
        this.set(group, cx, cy)
        const errors = this.evaluate()
        const score = errors.length * 100 + Math.sqrt(getDeficitEnergy(errors))
        const intersections = this.engine.lastRunStats.traceIntersectionCount
        if (intersections <= bestIntersections && score < bestScore) {
          bestIntersections = intersections
          bestX = cx
          bestY = cy
          bestErrors = errors
          bestScore = score
        }
      }
    }
    this.set(group, bestX, bestY)
    this.errors = bestErrors
    return bestX !== x || bestY !== y
  }

  private gradientStep(): boolean {
    const contacts = this.evaluate(true)
    const energy = getDeficitEnergy(contacts)
    const intersections = this.contactEngine.lastRunStats.traceIntersectionCount
    const groups = this.selectGroups(contacts, true).map((group) => ({
      group, x: group.points[0]!.x, y: group.points[0]!.y, dx: 0, dy: 0,
    }))
    const h = 0.0001
    for (const state of groups) {
      const { group, x, y } = state
      this.set(group, x + h, y)
      const xp = getDeficitEnergy(this.evaluate(true))
      this.set(group, x - h, y)
      const xm = getDeficitEnergy(this.evaluate(true))
      this.set(group, x, y + h)
      const yp = getDeficitEnergy(this.evaluate(true))
      this.set(group, x, y - h)
      const ym = getDeficitEnergy(this.evaluate(true))
      this.set(group, x, y)
      state.dx = (xp - xm) / (2 * h)
      state.dy = (yp - ym) / (2 * h)
    }
    for (const scale of [64, 16, 4, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.01]) {
      let valid = true
      for (const { group, x, y, dx, dy } of groups) {
        const factor = Math.min(scale, 0.15 / Math.max(1e-9, Math.hypot(dx, dy)))
        const cx = x - dx * factor
        const cy = y - dy * factor
        valid &&= this.inside(group, cx, cy)
        this.set(group, cx, cy)
      }
      if (valid && getDeficitEnergy(this.evaluate(true)) < energy - 1e-12 &&
        this.contactEngine.lastRunStats.traceIntersectionCount <= intersections) {
        this.errors = this.evaluate()
        return true
      }
    }
    for (const { group, x, y } of groups) this.set(group, x, y)
    return false
  }

  override _step(): void {
    if (this.phase === "done" && this.errors.length > 0 && !this.refined) {
      this.refined = true
      this.simplifyRoutes(true)
      this.errors = this.evaluate()
      if (this.refineRoutesNearErrors()) {
        this.buildCoordinateGroups()
        this.phase = "vias"
        this.queue = []
        this.cursor = 0
        this.pass = 0
        this.cycle = 0
        this.gradientIteration = 0
        this.errors = this.evaluate()
      }
    }
    if (this.errors.length === 0 || this.phase === "done") {
      this.stats = { ...this.stats, errors: this.errors.length }
      this.solved = true
      return
    }
    this.stats = { ...this.stats, phase: this.phase, cycle: this.cycle, pass: this.pass,
      errors: this.errors.length, gradientIteration: this.gradientIteration }
    if (this.phase === "gradient") {
      this.gradientIteration++
      if (!this.gradientStep() || this.gradientIteration >= 80) {
        this.phase = "polish"
        this.pass = 0
        this.queue = []
      }
      return
    }
    if (this.queue.length === 0) {
      this.queue = this.selectGroups(this.errors, this.phase === "vias")
        .filter((group) => this.phase !== "vias" || group.via)
      this.cursor = 0
      this.changed = false
    }
    if (this.cursor < this.queue.length) {
      this.changed = this.scan(this.queue[this.cursor++]!) || this.changed
      return
    }
    this.pass++
    // Seed the joint optimizer with one via pass. Repeated single-point scans
    // make little progress on coupled pad/trace constraints.
    if (!this.changed || this.pass >= (this.phase === "vias" ? 1 : 8)) {
      this.pass = 0
      if (this.phase === "vias") this.phase = "gradient"
      else {
        this.cycle++
        this.gradientIteration = 0
        this.phase = this.cycle < 3 ? "gradient" : "done"
      }
    }
    this.queue = []
  }

  override getOutput(): SimplifiedPcbTraces {
    return this.routes
  }
}
