import { mapZToLayerName } from "./mapZToLayerName"

type ViaLayers = {
  layers?: string[]
  from_layer?: string
  to_layer?: string
}

/**
 * Match Core's physical-via model for autorouted traces.
 *
 * A layer transition describes logical route geometry. Unless blind and
 * buried vias are enabled, its drilled barrel spans the full board stack.
 * When they are enabled, an explicit contiguous layer span wins; otherwise
 * the inclusive endpoint span is used.
 */
export const getViaLayers = (
  via: ViaLayers,
  layerCount: number,
  allowBlindAndBuriedVias = false,
): string[] => {
  if (!Number.isInteger(layerCount) || layerCount < 1) {
    throw new Error(`Invalid board layer count: ${layerCount}`)
  }
  const boardLayers = Array.from({ length: layerCount }, (_, z) =>
    mapZToLayerName(z, layerCount),
  )
  if (!allowBlindAndBuriedVias) return boardLayers

  if (via.layers?.length) {
    const physicalLayerSet = new Set(via.layers)
    const occupiedBoardLayers = boardLayers.filter((layer) =>
      physicalLayerSet.has(layer),
    )
    const firstOccupiedIndex = boardLayers.indexOf(occupiedBoardLayers[0]!)
    const lastOccupiedIndex = boardLayers.indexOf(
      occupiedBoardLayers[occupiedBoardLayers.length - 1]!,
    )
    const contiguousPhysicalSpan = boardLayers.slice(
      firstOccupiedIndex,
      lastOccupiedIndex + 1,
    )
    if (
      via.from_layer !== undefined &&
      via.to_layer !== undefined &&
      physicalLayerSet.has(via.from_layer) &&
      physicalLayerSet.has(via.to_layer) &&
      physicalLayerSet.size === contiguousPhysicalSpan.length &&
      contiguousPhysicalSpan.every((layer) => physicalLayerSet.has(layer))
    ) {
      return contiguousPhysicalSpan
    }
  }

  const from = boardLayers.findIndex((layer) => layer === via.from_layer)
  const to = boardLayers.findIndex((layer) => layer === via.to_layer)
  if (from < 0 || to < 0) {
    throw new Error(
      `Via span ${via.from_layer} -> ${via.to_layer} is outside the board`,
    )
  }
  return boardLayers.slice(Math.min(from, to), Math.max(from, to) + 1)
}
