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
type Phase = "vias" | "points" | "gradient" | "polish" | "done"

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
            ? (other.via_diameter ?? params.srj.minViaDiameter ?? 0.3) / 2
            : other.width / 2)),
        })
      }
    }
    this.errors = this.evaluate()
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
    let bestScore = this.errors.length * 100 + Math.sqrt(getDeficitEnergy(this.errors))
    const angles = this.phase === "vias" ? 32 : 16
    for (const radius of [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
      for (let angle = 0; angle < angles; angle++) {
        const cx = x + radius * Math.cos(angle * 2 * Math.PI / angles)
        const cy = y + radius * Math.sin(angle * 2 * Math.PI / angles)
        if (!this.inside(group, cx, cy)) continue
        this.set(group, cx, cy)
        const errors = this.evaluate()
        const score = errors.length * 100 + Math.sqrt(getDeficitEnergy(errors))
        if (score < bestScore) {
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
      if (valid && getDeficitEnergy(this.evaluate(true)) < energy - 1e-12) {
        this.errors = this.evaluate()
        return true
      }
    }
    for (const { group, x, y } of groups) this.set(group, x, y)
    return false
  }

  override _step(): void {
    if (this.errors.length === 0 || this.phase === "done") {
      this.stats = { ...this.stats, errors: this.errors.length }
      this.solved = true
      return
    }
    this.stats = { phase: this.phase, cycle: this.cycle, pass: this.pass,
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
    if (!this.changed || this.pass >= (this.phase === "vias" ? 4 : 8)) {
      this.pass = 0
      if (this.phase === "vias") this.phase = "points"
      else if (this.phase === "points") this.phase = "gradient"
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
