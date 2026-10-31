import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  TraceContactRepairSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../../lib"

type GameBoyInput = {
  srj: SimpleRouteJson & { outline: Array<{ x: number; y: number }> }
  hdRoutes: HighDensityRoute[]
  inputHdRoutes: HighDensityRoute[]
  netMap: Record<string, string[]>
}
type GameBoyRepair = {
  input: GameBoyInput
  original: GameBoyInput
  connMap: ConnectivityMap
  solver: TraceContactRepairSolver
  output: HighDensityRoute[]
}
type RoutePoint = HighDensityRoute["route"][number]
type ContactGeometry = {
  gap: number
  start: RoutePoint
  end: RoutePoint
  via: HighDensityRoute["vias"][number]
}

let repair: GameBoyRepair | undefined

/**
 * Real Pipeline9 final-contact-owner input, captured from autorouter 90fb4ff:
 * fixtures/bug-reports/bugreport96-full-gameboy-no-breakout/
 * bugreport96-full-gameboy-no-breakout.srj.json.
 * The capture retains all 119 repair routes, 378 obstacles and net aliases.
 * Replay uses repair03's native evaluator, not Pipeline9's baseline-filtered DRC.
 */
export const getGameBoyContactRepair = (): GameBoyRepair => {
  if (repair) return repair
  const input: GameBoyInput = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("./gameboy-before-contact-repair.json.gz", import.meta.url),
      ),
    ).toString(),
  )
  const original = structuredClone(input)
  const connMap = new ConnectivityMap(input.netMap)
  const solver = new TraceContactRepairSolver({
    ...input,
    connMap,
    effort: 1,
    maxIterations: 32,
    broadMaxIterations: 12,
    broadPassMultiplier: 3,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enableTraceViaOwnerTargeting: true,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  })
  solver.solve()
  repair = { input, original, connMap, solver, output: solver.getOutput() }
  return repair
}

/** Independent physical gap for source_trace_178 against source_trace_176's vias. */
export const getGameBoyTraceViaContact = (
  routes: HighDensityRoute[],
): { gap: number; graphics: GraphicsObject; center: RoutePoint } => {
  const trace = routes.find(
    (route) => route.connectionName === "source_trace_178",
  )
  const viaRoute = routes.find(
    (route) => route.connectionName === "source_trace_176",
  )
  if (!trace || !viaRoute)
    throw new Error("Game Boy contact routes are missing")
  let nearest: ContactGeometry | undefined
  for (const via of viaRoute.vias) {
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]!
      const end = trace.route[index]!
      if (start.z !== end.z) continue
      const dx = end.x - start.x
      const dy = end.y - start.y
      const squaredLength = dx * dx + dy * dy
      const t =
        squaredLength === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((via.x - start.x) * dx + (via.y - start.y) * dy) /
                  squaredLength,
              ),
            )
      const gap =
        Math.hypot(via.x - start.x - t * dx, via.y - start.y - t * dy) -
        (trace.traceThickness + viaRoute.viaDiameter) / 2
      if (!nearest || gap < nearest.gap) nearest = { gap, start, end, via }
    }
  }
  if (!nearest) throw new Error("Game Boy contact geometry is missing")
  const radius = viaRoute.viaDiameter / 2
  const margin = trace.traceThickness / 2 + 0.1
  const minX =
    Math.min(nearest.start.x, nearest.end.x, nearest.via.x - radius) - margin
  const maxX =
    Math.max(nearest.start.x, nearest.end.x, nearest.via.x + radius) + margin
  const minY =
    Math.min(nearest.start.y, nearest.end.y, nearest.via.y - radius) - margin
  const maxY =
    Math.max(nearest.start.y, nearest.end.y, nearest.via.y + radius) + margin
  return {
    gap: nearest.gap,
    center: { ...nearest.via, z: nearest.start.z },
    graphics: {
      coordinateSystem: "cartesian",
      rects: [
        {
          center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
          width: maxX - minX,
          height: maxY - minY,
          fill: "rgba(255, 255, 255, 0)",
        },
      ],
      lines: [
        {
          points: [nearest.start, nearest.end],
          strokeWidth: trace.traceThickness,
          strokeColor: "#2563eb",
          label: "source_trace_178 copper",
        },
      ],
      circles: [
        {
          center: nearest.via,
          radius: viaRoute.viaDiameter / 2,
          fill: "#9333ea",
          label: "source_trace_176 through via",
        },
      ],
    },
  }
}
