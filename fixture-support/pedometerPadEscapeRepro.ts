import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
  type GraphicsObject,
} from "graphics-debug"
import {
  AutoroutingDrcEngine,
  FinePitchPadEscapeSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../lib"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"
import capture from "../tests/fixtures/pedometer-bga-pad-escape.json"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"

export const createPedometerPadEscapeRepro = () => {
  const srj = capture.srj as SimpleRouteJson
  const routes = structuredClone(capture.routes) as HighDensityRoute[]
  const engine = new AutoroutingDrcEngine(srj, {
    traceClearance: srj.minTraceToPadEdgeClearance,
    viaToPadClearance: srj.minViaEdgeToPadEdgeClearance,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
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
  const initial = drcEvaluator({ hdRoutes: routes, traces: [] })
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  const solver = new FinePitchPadEscapeSolver({
    srj,
    routes,
    drcEvaluator,
    routeIndexByTraceId: new Map([["trace_0", 0]]),
  })
  solver.solve()
  const result = solver.getOutput()
  return { srj, routes, initialErrors, result, solver }
}

type Repro = ReturnType<typeof createPedometerPadEscapeRepro>

export const getPedometerPadEscapeGraphics = (
  repro: Repro,
  phase: "before" | "after",
): GraphicsObject => {
  const routes = phase === "before" ? repro.routes : repro.result.routes
  const route = routes[0]!
  // Show the last top-layer escape span, starting at its fixed via. No route
  // geometry is changed for the view; remote spans are simply not drawn.
  const lastLayerTransition = route.route.findLastIndex(
    (point, index) => index > 0 && point.z !== route.route[index - 1]!.z,
  )
  const escape = route.route.slice(lastLayerTransition)
  const clearance = repro.srj.minTraceToPadEdgeClearance!
  const pads = repro.srj.obstacles.filter(
    (pad) =>
      pad.center.x > -6.7 &&
      pad.center.x < -5.7 &&
      pad.center.y > -1.05 &&
      pad.center.y < 0,
  )
  const errors =
    phase === "before" ? repro.initialErrors : repro.result.remainingErrors
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: phase === "before" ? "Before repair" : "After repair",
    rects: [
      {
        center: { x: -6.2, y: -0.35 },
        width: 1.25,
        height: 1.75,
        fill: "transparent",
        stroke: "transparent",
      },
      ...pads.map((pad) => ({
        center: pad.center,
        width: pad.width + 2 * clearance,
        height: pad.height + 2 * clearance,
        fill: "rgba(148, 163, 184, 0.15)",
        stroke: "#cbd5e1",
        label: `${pad.obstacleId}: 0.05 mm clearance envelope`,
      })),
      ...pads.map((pad) => ({
        center: pad.center,
        width: pad.width,
        height: pad.height,
        fill:
          pad.obstacleId === "pcb_smtpad_33"
            ? "rgba(74, 222, 128, 0.35)"
            : pad.obstacleId === "pcb_smtpad_34"
              ? "rgba(248, 113, 113, 0.45)"
              : "rgba(148, 163, 184, 0.45)",
        stroke: pad.obstacleId === "pcb_smtpad_34" ? "#dc2626" : "#64748b",
        label: pad.obstacleId,
      })),
    ],
    lines: [
      {
        points: escape,
        strokeColor: "#2563eb",
        strokeWidth: route.traceThickness,
        label: "source_trace_44: 0.10 mm copper",
      },
    ],
    circles: [
      {
        center: escape[0]!,
        radius: route.viaDiameter / 2,
        fill: "#334155",
        stroke: "#0f172a",
        label: "Fixed via",
      },
      ...escape.slice(1, -1).map((point) => ({
        center: point,
        radius: 0.012,
        fill: "white",
        stroke: "#1e40af",
        label: "Interior bend",
      })),
      {
        center: escape.at(-1)!,
        radius: 0.022,
        fill: "#15803d",
        stroke: "white",
        label: "Fixed terminal",
      },
    ],
    texts: [
      ...pads.map((pad) => ({
        x: pad.center.x,
        y: pad.center.y - (pad.obstacleId === "pcb_smtpad_33" ? 0.19 : 0),
        text:
          pad.obstacleId === "pcb_smtpad_33"
            ? "33 / terminal"
            : pad.obstacleId!.replace("pcb_smtpad_", ""),
        fontSize: 0.045,
        anchorSide: "center" as const,
        color: "#334155",
      })),
      {
        x: -6.2,
        y: 0.4,
        text: `${errors.length} DRC ${errors.length === 1 ? "error" : "errors"}`,
        fontSize: 0.07,
        anchorSide: "center",
        color: phase === "before" ? "#b91c1c" : "#15803d",
      },
      {
        x: -6.2,
        y: -1.14,
        text:
          phase === "before"
            ? "Copper crosses pad 34"
            : "Interior bends enter the open channel",
        fontSize: 0.045,
        anchorSide: "center",
        color: "#334155",
      },
    ],
  }
  return graphics
}

export const getPedometerPadEscapeSnapshotSvg = (repro: Repro): string =>
  getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [
        getPedometerPadEscapeGraphics(repro, "before"),
        getPedometerPadEscapeGraphics(repro, "after"),
      ],
      { titles: ["Before repair", "After repair"] },
    ),
    {
      backgroundColor: "white",
      svgWidth: 1400,
      svgHeight: 850,
      includeTextLabels: false,
    },
  ).replace(/[ \t]+$/gm, "")
