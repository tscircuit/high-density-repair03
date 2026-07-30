import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBounds } from "graphics-debug"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  type GlobalDrcForceImproveSolverParams,
  type HighDensityRoute,
  type SimpleRouteJson,
  type SimplifiedPcbTrace,
} from "../lib"
import {
  getDrcMarkersForSolver,
  VisualizedGlobalDrcForceImproveSolver,
} from "./VisualizedGlobalDrcForceImproveSolver"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import { mapZToLayerName } from "../lib/utils/mapZToLayerName"
import type { SimpleRouteConnection } from "../types/srj-types"

export type Drc14DatasetSample = {
  id?: string
  simpleRouteJson?: SimpleRouteJson & { traces?: SimplifiedPcbTrace[] }
  metadata?: {
    relaxedDrcErrorCount?: number
    relaxedDrcPassed?: boolean
    sourceDataset?: string
    routingPipeline?: string
  }
}

type SolverOptions = Omit<
  GlobalDrcForceImproveSolverParams,
  "srj" | "hdRoutes" | "connMap" | "drcEvaluator" | "autoroutingDrcEngine"
>

export type DrcProblemsFixtureSample = {
  id: string
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  connMap?: ConnectivityMap
  solverOptions?: SolverOptions
}

export type DrcProblemsFixtureSampleSource = {
  id: string
  load: () => DrcProblemsFixtureSample | Promise<DrcProblemsFixtureSample>
}

type DrcProblemsFixtureProps = {
  datasetLabel: string
  fixtureId: string
  sampleSources: DrcProblemsFixtureSampleSource[]
}

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

const GRAPHICS_INITIAL_SIZE = 600

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

const getLayerZ = (layer: string, layerCount: number) => {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(0, layerCount - 1)

  const innerLayerMatch = layer.match(/^inner(\d+)$/)
  if (innerLayerMatch) {
    const z = Number(innerLayerMatch[1])
    if (Number.isInteger(z) && z > 0 && z < layerCount - 1) return z
  }

  throw new Error(`Unsupported route layer: ${layer}`)
}

const pushRoutePoint = (
  route: HighDensityRoute["route"],
  point: HighDensityRoute["route"][number],
) => {
  const lastPoint = route[route.length - 1]
  if (
    lastPoint &&
    lastPoint.x === point.x &&
    lastPoint.y === point.y &&
    lastPoint.z === point.z
  ) {
    return
  }
  route.push(point)
}

const getConnectionNameForTrace = (
  trace: SimplifiedPcbTrace,
  connections: SimpleRouteConnection[],
) => {
  const matchingConnection = connections
    .filter((connection) =>
      trace.pcb_trace_id.startsWith(`${connection.name}_`),
    )
    .sort((a, b) => b.name.length - a.name.length)[0]

  return matchingConnection?.name ?? trace.connection_name
}

const traceToHdRoute = (
  trace: SimplifiedPcbTrace,
  srj: SimpleRouteJson,
): HighDensityRoute => {
  const route: HighDensityRoute["route"] = []
  const vias: HighDensityRoute["vias"] = []
  let traceThickness = srj.minTraceWidth
  let viaDiameter = srj.minViaDiameter ?? 0.3

  for (const segment of trace.route) {
    if (segment.route_type === "wire") {
      traceThickness = segment.width
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.layer, srj.layerCount),
        ...(segment.start_pcb_port_id
          ? { pcb_port_id: segment.start_pcb_port_id }
          : {}),
        ...(segment.end_pcb_port_id
          ? { pcb_port_id: segment.end_pcb_port_id }
          : {}),
      })
      continue
    }

    if (segment.route_type === "via") {
      viaDiameter = segment.via_diameter ?? viaDiameter
      vias.push({ x: segment.x, y: segment.y })
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.from_layer, srj.layerCount),
      })
      pushRoutePoint(route, {
        x: segment.x,
        y: segment.y,
        z: getLayerZ(segment.to_layer, srj.layerCount),
      })
      continue
    }

    pushRoutePoint(route, {
      x: segment.start.x,
      y: segment.start.y,
      z: getLayerZ(segment.layer, srj.layerCount),
    })
    pushRoutePoint(route, {
      x: segment.end.x,
      y: segment.end.y,
      z: getLayerZ(segment.layer, srj.layerCount),
    })
  }

  return {
    connectionName: getConnectionNameForTrace(trace, srj.connections),
    rootConnectionName: trace.connection_name,
    traceThickness,
    viaDiameter,
    route,
    vias,
  }
}

export const createDrc14ProblemsFixtureSample = (
  sample: Drc14DatasetSample,
  sampleIndex: number,
): DrcProblemsFixtureSample => {
  const srj = sample.simpleRouteJson
  if (!srj) {
    throw new Error("Sample is missing simpleRouteJson")
  }
  if (!srj.traces || srj.traces.length === 0) {
    throw new Error("Sample simpleRouteJson is missing traces")
  }

  return {
    id: sample.id ?? `sample${String(sampleIndex + 1).padStart(3, "0")}`,
    srj,
    hdRoutes: srj.traces.map((trace) => traceToHdRoute(trace, srj)),
  }
}

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

export function DrcProblemsFixture({
  datasetLabel,
  fixtureId,
  sampleSources,
}: DrcProblemsFixtureProps) {
  const debuggerRootRef = useRef<HTMLDivElement | null>(null)
  const [sampleNumberInput, setSampleNumberInput] = useState("1")
  const [effortInput, setEffortInput] = useState("1")
  const [maxIterationsInput, setMaxIterationsInput] = useState("")
  const [visibleLayer, setVisibleLayer] = useState<"all" | string>("all")
  const [selectedDrcMarkerIndex, setSelectedDrcMarkerIndex] = useState<
    number | null
  >(null)
  const [solverRevision, setSolverRevision] = useState(0)
  const [drcMarkerRevision, setDrcMarkerRevision] = useState(0)
  const [cameraRevision, setCameraRevision] = useState(0)
  const [loadedSample, setLoadedSample] =
    useState<DrcProblemsFixtureSample | null>(null)
  const [sampleLoadError, setSampleLoadError] = useState<string | null>(null)

  const maxSampleNumber = sampleSources.length
  const parsedSampleNumber = Number.parseInt(sampleNumberInput, 10)
  const safeSampleNumber = Number.isFinite(parsedSampleNumber)
    ? Math.min(Math.max(parsedSampleNumber, 1), maxSampleNumber)
    : 1
  const selectedSampleSource =
    sampleSources[safeSampleNumber - 1] ?? sampleSources[0]
  const effort = parsePositiveNumberInput(effortInput, 1)
  const maxIterations = parsePositiveIntegerInput(maxIterationsInput)

  useEffect(() => {
    let cancelled = false
    setLoadedSample(null)
    setSampleLoadError(null)
    if (!selectedSampleSource) return

    Promise.resolve(selectedSampleSource.load())
      .then((sample) => {
        if (!cancelled) setLoadedSample(sample)
      })
      .catch((error) => {
        if (cancelled) return
        setSampleLoadError(
          error instanceof Error ? error.message : String(error),
        )
      })

    return () => {
      cancelled = true
    }
  }, [selectedSampleSource])

  const input =
    loadedSample?.id === selectedSampleSource?.id ? loadedSample : null

  const initialDrcCount = useMemo(() => {
    if (!input) return null
    return getDrcSnapshot(input.srj, input.hdRoutes, undefined, input.connMap)
      .count
  }, [input])
  const layerOptions = useMemo(() => {
    if (!input) return ["all"]
    const { srj } = input
    return [
      "all",
      ...Array.from({ length: srj.layerCount }, (_, z) =>
        mapZToLayerName(z, srj.layerCount),
      ),
    ]
  }, [input])
  const solver = useMemo(() => {
    if (!input) return null
    const {
      effort: _capturedEffort,
      maxIterations: capturedMaxIterations,
      ...capturedOptions
    } = input.solverOptions ?? {}
    const effectiveMaxIterations = maxIterations ?? capturedMaxIterations

    return new VisualizedGlobalDrcForceImproveSolver({
      ...capturedOptions,
      srj: input.srj,
      hdRoutes: input.hdRoutes,
      connMap: input.connMap,
      effort,
      visibleLayer,
      ...(effectiveMaxIterations !== undefined
        ? { maxIterations: effectiveMaxIterations }
        : {}),
    })
  }, [
    input,
    effort,
    maxIterations,
    visibleLayer,
    solverRevision,
    cameraRevision,
  ])
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
  }, [selectedSampleSource, effort, maxIterations, visibleLayer])

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

  if (!selectedSampleSource) {
    return <div>No {datasetLabel} samples found.</div>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor={`${fixtureId}-sample-number`}>Sample #</label>
        <input
          id={`${fixtureId}-sample-number`}
          type="number"
          min={1}
          max={maxSampleNumber}
          value={sampleNumberInput}
          onChange={(event) => setSampleNumberInput(event.currentTarget.value)}
          style={{ width: 96 }}
        />
        <button
          type="button"
          onClick={() =>
            setSampleNumberInput(String(Math.max(1, safeSampleNumber - 1)))
          }
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() =>
            setSampleNumberInput(
              String(Math.min(maxSampleNumber, safeSampleNumber + 1)),
            )
          }
        >
          Next
        </button>
        <label htmlFor={`${fixtureId}-effort`}>Effort</label>
        <input
          id={`${fixtureId}-effort`}
          type="number"
          min={0.1}
          step={0.1}
          value={effortInput}
          onChange={(event) => setEffortInput(event.currentTarget.value)}
          style={{ width: 72 }}
        />
        <label htmlFor={`${fixtureId}-max-iterations`}>Max iterations</label>
        <input
          id={`${fixtureId}-max-iterations`}
          type="number"
          min={1}
          placeholder={String(input?.solverOptions?.maxIterations ?? "auto")}
          value={maxIterationsInput}
          onChange={(event) => setMaxIterationsInput(event.currentTarget.value)}
          style={{ width: 112 }}
        />
        <label htmlFor={`${fixtureId}-visible-layer`}>Layer</label>
        <select
          id={`${fixtureId}-visible-layer`}
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
        {selectedSampleSource.id} ({safeSampleNumber} / {maxSampleNumber})
        initialDrc={initialDrcCount ?? "n/a"} traces=
        {input?.hdRoutes.length ?? "n/a"}
      </div>

      {sampleLoadError ? (
        <div>Failed to load sample: {sampleLoadError}</div>
      ) : null}
      {!input && !sampleLoadError ? (
        <div>Loading {datasetLabel} sample…</div>
      ) : null}

      {solver ? (
        <div ref={debuggerRootRef}>
          <GenericSolverDebugger
            key={`${selectedSampleSource.id}-${effort}-${maxIterations ?? "auto"}-${visibleLayer}-${solverRevision}-${cameraRevision}-${selectedDrcMarker?.id ?? "all"}`}
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
