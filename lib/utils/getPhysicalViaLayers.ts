type PhysicalViaLayersOptions = {
  layerCount: number
  fromLayer: string
  toLayer: string
  allowBlindAndBuriedVias?: boolean
  physicalLayers?: readonly string[]
}

/** Resolve occupied copper layers, rather than just the route's transition. */
export function getPhysicalViaLayers({
  layerCount,
  fromLayer,
  toLayer,
  allowBlindAndBuriedVias = false,
  physicalLayers,
}: PhysicalViaLayersOptions): string[] {
  if (!Number.isInteger(layerCount) || layerCount < 1) {
    throw new Error(`Invalid board layer count: ${layerCount}`)
  }
  const boardLayers =
    layerCount === 1
      ? ["top"]
      : [
          "top",
          ...Array.from({ length: layerCount - 2 }, (_, i) => `inner${i + 1}`),
          "bottom",
        ]
  const from = boardLayers.indexOf(fromLayer)
  const to = boardLayers.indexOf(toLayer)
  if (from < 0 || to < 0) {
    throw new Error(
      `Via transition ${fromLayer} -> ${toLayer} is outside the board layer stack`,
    )
  }
  if (!allowBlindAndBuriedVias) return boardLayers

  if (physicalLayers) {
    const occupied = new Set(physicalLayers)
    const ordered = boardLayers.filter((layer) => occupied.has(layer))
    const firstLayer = ordered[0]
    const lastLayer = ordered[ordered.length - 1]
    if (firstLayer === undefined || lastLayer === undefined) {
      throw new Error("Physical via layers must contain board layers")
    }
    const first = boardLayers.indexOf(firstLayer)
    const last = boardLayers.indexOf(lastLayer)
    if (
      !occupied.has(fromLayer) ||
      !occupied.has(toLayer) ||
      ordered.length !== physicalLayers.length ||
      last - first + 1 !== ordered.length
    ) {
      throw new Error(
        "Physical via layers must be a contiguous board span containing both transition layers",
      )
    }
    return ordered
  }
  return boardLayers.slice(Math.min(from, to), Math.max(from, to) + 1)
}
