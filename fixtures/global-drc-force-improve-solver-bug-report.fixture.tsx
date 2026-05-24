import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { getBounds } from "graphics-debug"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  getDrcMarkersForSolver,
  VisualizedGlobalDrcForceImproveSolver,
} from "../fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type { HighDensityRoute, SimpleRouteJson } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import { mapZToLayerName } from "../lib/utils/mapZToLayerName"
import bugReportInputRaw from "../globalDrcForceImproveSolver_input (1).json?raw"

type BugReportSolverInput = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  effort?: number
  maxIterations?: number
  enableLargeBoardBroadFallback?: boolean
}

const bugReportInputs = JSON.parse(bugReportInputRaw) as BugReportSolverInput[]
const bugReportInput = bugReportInputs[0]
const GRAPHICS_INITIAL_SIZE = 600

type RuntimeElement = {
  style?: {
    position?: string
    overflow?: string
  }
  getBoundingClientRect: () => {
    left: number
    top: number
    width: number
    height: number
  }
  dispatchEvent: (event: unknown) => void
}

type RuntimeRoot = {
  querySelectorAll: (selector: string) => ArrayLike<RuntimeElement>
}

const findGraphicsViewport = (root: RuntimeRoot): RuntimeElement | null =>
  Array.from(root.querySelectorAll("div"))
    .filter(
      (element) =>
        element.style?.position === "relative" &&
        element.style?.overflow === "hidden",
    )
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { element, area: rect.width * rect.height }
    })
    .sort((a, b) => b.area - a.area)[0]?.element ?? null

const parsePositiveIntegerInput = (value: string) => {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined
}

const parsePositiveNumberInput = (value: string, fallback: number) => {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback
}

const getThroughObstacleTransitionCount = (input: BugReportSolverInput) =>
  input.hdRoutes.reduce(
    (count, route) =>
      count +
      route.route.filter(
        (point) => point.toNextSegmentType === "through_obstacle",
      ).length,
    0,
  )

export default function GlobalDrcForceImproveSolverBugReportFixture() {
  const debuggerRootRef = useRef<HTMLDivElement | null>(null)
  const [effortInput, setEffortInput] = useState(
    String(bugReportInput?.effort ?? 1),
  )
  const [maxIterationsInput, setMaxIterationsInput] = useState(
    bugReportInput?.maxIterations !== undefined
      ? String(bugReportInput.maxIterations)
      : "",
  )
  const [visibleLayer, setVisibleLayer] = useState<"all" | string>("all")
  const [selectedDrcMarkerIndex, setSelectedDrcMarkerIndex] = useState<
    number | null
  >(null)
  const [solverRevision, setSolverRevision] = useState(0)
  const [drcMarkerRevision, setDrcMarkerRevision] = useState(0)
  const [cameraRevision, setCameraRevision] = useState(0)

  const effort = parsePositiveNumberInput(
    effortInput,
    bugReportInput?.effort ?? 1,
  )
  const maxIterations = parsePositiveIntegerInput(maxIterationsInput)

  const layerOptions = useMemo(() => {
    if (!bugReportInput) return ["all"]
    return [
      "all",
      ...Array.from({ length: bugReportInput.srj.layerCount }, (_, z) =>
        mapZToLayerName(z, bugReportInput.srj.layerCount),
      ),
    ]
  }, [])

  const initialDrcCount = useMemo(() => {
    if (!bugReportInput) return null
    return getDrcSnapshot(bugReportInput.srj, bugReportInput.hdRoutes).count
  }, [])
  const throughObstacleTransitionCount = useMemo(
    () =>
      bugReportInput ? getThroughObstacleTransitionCount(bugReportInput) : 0,
    [],
  )

  const solver = useMemo(() => {
    if (!bugReportInput) return null
    return new VisualizedGlobalDrcForceImproveSolver({
      srj: bugReportInput.srj,
      hdRoutes: bugReportInput.hdRoutes,
      effort,
      visibleLayer,
      ...(maxIterations !== undefined ? { maxIterations } : {}),
      enableLargeBoardBroadFallback:
        bugReportInput.enableLargeBoardBroadFallback,
    })
  }, [effort, maxIterations, visibleLayer, solverRevision, cameraRevision])

  const drcMarkers = useMemo(
    () => (solver ? getDrcMarkersForSolver(solver) : []),
    [solver, drcMarkerRevision],
  )
  const selectedDrcMarker =
    drcMarkers.length > 0 && selectedDrcMarkerIndex !== null
      ? (drcMarkers[Math.min(selectedDrcMarkerIndex, drcMarkers.length - 1)] ??
        null)
      : null
  const selectedDrcMarkerDisplayIndex = selectedDrcMarker
    ? drcMarkers.findIndex((marker) => marker.id === selectedDrcMarker.id) + 1
    : 0

  solver?.setSelectedDrcMarkerId(selectedDrcMarker?.id)

  const resetCamera = () => {
    setSelectedDrcMarkerIndex(null)
    setCameraRevision((revision) => revision + 1)
  }

  const resetSolver = () => {
    setSelectedDrcMarkerIndex(null)
    setDrcMarkerRevision((revision) => revision + 1)
    setCameraRevision((revision) => revision + 1)
    setSolverRevision((revision) => revision + 1)
  }

  useEffect(() => {
    setSelectedDrcMarkerIndex(null)
    setDrcMarkerRevision((revision) => revision + 1)
  }, [effort, maxIterations, visibleLayer])

  useEffect(() => {
    if (!selectedDrcMarker || !solver) return

    const root = debuggerRootRef.current as unknown as RuntimeRoot | null
    if (!root) return

    const runtime = globalThis as unknown as {
      MouseEvent?: new (type: string, eventInitDict?: unknown) => unknown
      WheelEvent?: new (type: string, eventInitDict?: unknown) => unknown
      dispatchEvent?: (event: unknown) => void
      requestAnimationFrame?: (callback: () => void) => number
      setTimeout?: (callback: () => void, delay: number) => number
    }
    const MouseEventCtor = runtime.MouseEvent
    const WheelEventCtor = runtime.WheelEvent ?? runtime.MouseEvent
    if (!MouseEventCtor || !WheelEventCtor) return

    const schedule =
      runtime.requestAnimationFrame ??
      ((callback: () => void) => {
        setTimeout(callback, 16)
        return 0
      })
    let cancelled = false

    const focusSelectedMarker = (attempt = 0) => {
      if (cancelled) return
      const viewport = findGraphicsViewport(root)
      if (!viewport) {
        if (attempt < 5) {
          runtime.setTimeout?.(() => focusSelectedMarker(attempt + 1), 100)
        }
        return
      }
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        if (attempt < 5) {
          runtime.setTimeout?.(() => focusSelectedMarker(attempt + 1), 100)
        }
        return
      }

      const graphicsBounds = getBounds(solver.visualize())
      const graphicsWidth = Math.max(
        graphicsBounds.maxX - graphicsBounds.minX,
        1,
      )
      const graphicsHeight = Math.max(
        graphicsBounds.maxY - graphicsBounds.minY,
        1,
      )
      const paddedMinX = graphicsBounds.minX - graphicsWidth / 10
      const paddedMaxX = graphicsBounds.maxX + graphicsWidth / 10
      const paddedMinY = graphicsBounds.minY - graphicsHeight / 10
      const paddedMaxY = graphicsBounds.maxY + graphicsHeight / 10
      const paddedWidth = paddedMaxX - paddedMinX
      const paddedHeight = paddedMaxY - paddedMinY
      const initialScale = Math.min(
        GRAPHICS_INITIAL_SIZE / paddedWidth,
        GRAPHICS_INITIAL_SIZE / paddedHeight,
      )
      const targetZoomFactor = Math.max(
        2.4,
        Math.min(8, Math.max(paddedWidth, paddedHeight) / 7),
      )
      const wheelScale = 1.14
      const wheelSteps = Math.max(
        1,
        Math.ceil(Math.log(targetZoomFactor) / Math.log(wheelScale)),
      )
      const wheelDeltaY = -(wheelScale - 1) * 1000
      const boardCenterX = (paddedMinX + paddedMaxX) / 2
      const boardCenterY = (paddedMinY + paddedMaxY) / 2
      const markerClientX =
        rect.left +
        GRAPHICS_INITIAL_SIZE / 2 +
        initialScale * (selectedDrcMarker.center.x - boardCenterX)
      const markerClientY =
        rect.top +
        GRAPHICS_INITIAL_SIZE / 2 -
        initialScale * (selectedDrcMarker.center.y - boardCenterY)
      const viewportCenterX = rect.left + rect.width / 2
      const viewportCenterY = rect.top + rect.height / 2
      const scrollX =
        (globalThis as unknown as { scrollX?: number; pageXOffset?: number })
          .scrollX ??
        (globalThis as unknown as { scrollX?: number; pageXOffset?: number })
          .pageXOffset ??
        0
      const scrollY =
        (globalThis as unknown as { scrollY?: number; pageYOffset?: number })
          .scrollY ??
        (globalThis as unknown as { scrollY?: number; pageYOffset?: number })
          .pageYOffset ??
        0

      const panPointToCenter = (clientX: number, clientY: number) => {
        viewport.dispatchEvent(
          new MouseEventCtor("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            pageX: clientX + scrollX,
            pageY: clientY + scrollY,
          }),
        )
        runtime.dispatchEvent?.(
          new MouseEventCtor("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: viewportCenterX,
            clientY: viewportCenterY,
            pageX: viewportCenterX + scrollX,
            pageY: viewportCenterY + scrollY,
          }),
        )
        viewport.dispatchEvent(
          new MouseEventCtor("mouseup", {
            bubbles: true,
            cancelable: true,
            clientX: viewportCenterX,
            clientY: viewportCenterY,
            pageX: viewportCenterX + scrollX,
            pageY: viewportCenterY + scrollY,
          }),
        )
      }

      const recenterSelectedMarker = () => {
        if (cancelled) return
        panPointToCenter(markerClientX, markerClientY)
      }

      const zoomChunkSize = 2
      const animateZoom = (remainingSteps: number) => {
        if (cancelled) return
        if (remainingSteps <= 0) {
          schedule(() => schedule(recenterSelectedMarker))
          return
        }
        const stepsThisFrame = Math.min(zoomChunkSize, remainingSteps)
        for (let index = 0; index < stepsThisFrame; index += 1) {
          viewport.dispatchEvent(
            new WheelEventCtor("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: markerClientX,
              clientY: markerClientY,
              pageX: markerClientX + scrollX,
              pageY: markerClientY + scrollY,
              deltaY: wheelDeltaY,
            }),
          )
        }
        schedule(() => animateZoom(remainingSteps - stepsThisFrame))
      }

      animateZoom(wheelSteps)
    }

    schedule(() => schedule(() => focusSelectedMarker()))
    return () => {
      cancelled = true
    }
  }, [selectedDrcMarker?.id, solver])

  const selectRelativeDrcMarker = (offset: number) => {
    if (drcMarkers.length === 0) return
    setDrcMarkerRevision((revision) => revision + 1)
    setSelectedDrcMarkerIndex((index) => {
      const baseIndex = index === null || !drcMarkers[index] ? -1 : index
      return (baseIndex + offset + drcMarkers.length) % drcMarkers.length
    })
  }

  if (!bugReportInput) {
    return <div>No bug report solver input found.</div>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="bug-report-effort">Effort</label>
        <input
          id="bug-report-effort"
          type="number"
          min={0.1}
          step={0.1}
          value={effortInput}
          onChange={(event) => setEffortInput(event.currentTarget.value)}
          style={{ width: 72 }}
        />
        <label htmlFor="bug-report-max-iterations">Max iterations</label>
        <input
          id="bug-report-max-iterations"
          type="number"
          min={1}
          placeholder="auto"
          value={maxIterationsInput}
          onChange={(event) => setMaxIterationsInput(event.currentTarget.value)}
          style={{ width: 112 }}
        />
        <label htmlFor="bug-report-visible-layer">Layer</label>
        <select
          id="bug-report-visible-layer"
          value={visibleLayer}
          onChange={(event) => setVisibleLayer(event.currentTarget.value)}
        >
          {layerOptions.map((layer) => (
            <option key={layer} value={layer}>
              {layer}
            </option>
          ))}
        </select>
        <button type="button" onClick={resetSolver}>
          Reset
        </button>
        <span>DRC markers: {drcMarkers.length}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>
          DRC marker:{" "}
          {selectedDrcMarker
            ? `${selectedDrcMarkerDisplayIndex} / ${drcMarkers.length} (${selectedDrcMarker.status})`
            : "none"}
        </span>
        <button
          type="button"
          disabled={drcMarkers.length === 0}
          onClick={() => selectRelativeDrcMarker(-1)}
        >
          ←
        </button>
        <button
          type="button"
          disabled={drcMarkers.length === 0}
          onClick={() => selectRelativeDrcMarker(1)}
        >
          →
        </button>
        <button
          type="button"
          onClick={resetCamera}
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            background: "#ffffff",
            padding: "4px 10px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
          }}
        >
          Reset Camera
        </button>
      </div>

      <div style={{ fontFamily: "monospace", fontSize: 12 }}>
        globalDrcForceImproveSolver_input (1).json initialDrc=
        {initialDrcCount ?? "n/a"} throughObstacleTransitions=
        {throughObstacleTransitionCount} traces={bugReportInput.hdRoutes.length}
      </div>

      {solver ? (
        <div ref={debuggerRootRef}>
          <GenericSolverDebugger
            key={`bug-report-${effort}-${maxIterations ?? "auto"}-${visibleLayer}-${solverRevision}-${cameraRevision}-${selectedDrcMarker?.id ?? "all"}`}
            solver={solver}
            onSolverCompleted={() =>
              setDrcMarkerRevision((revision) => revision + 1)
            }
          />
        </div>
      ) : null}
    </div>
  )
}
