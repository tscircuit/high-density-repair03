import { mapZToLayerName } from "./mapZToLayerName"

type ViaSpan = {
  from_layer: string
  to_layer: string
}

/** Vias occupy every board layer unless blind and buried vias are enabled. */
export const getViaLayers = (
  via: ViaSpan,
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
  const from = boardLayers.findIndex((layer) => layer === via.from_layer)
  const to = boardLayers.findIndex((layer) => layer === via.to_layer)
  if (from < 0 || to < 0) {
    throw new Error(
      `Via span ${via.from_layer} -> ${via.to_layer} is outside the board`,
    )
  }
  return boardLayers.slice(Math.min(from, to), Math.max(from, to) + 1)
}
