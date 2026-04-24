export type LayerName = "top" | "bottom" | `inner${number}`

export const mapZToLayerName = (z: number, layerCount: number) => {
  if (z === 0) return "top"
  if (z === layerCount - 1) return "bottom"
  return `inner${z}`
}
