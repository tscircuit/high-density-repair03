import { mapZToLayerName } from "./mapZToLayerName"

type PhysicalViaSpan = {
  fromZ: number
  toZ: number
  layerCount: number
  allowBlindAndBuriedVias?: boolean
}

const mapLayerNameToZ = (layer: string, layerCount: number): number | null => {
  if (layer === "top") return 0
  if (layer === "bottom") return layerCount - 1
  const innerMatch = /^inner(\d+)$/.exec(layer)
  if (!innerMatch) return null
  const z = Number(innerMatch[1])
  return Number.isInteger(z) && z > 0 && z < layerCount - 1 ? z : null
}

export const getPhysicalViaZLayers = ({
  fromZ,
  toZ,
  layerCount,
  allowBlindAndBuriedVias,
}: PhysicalViaSpan): number[] => {
  const minZ = allowBlindAndBuriedVias === false ? 0 : Math.min(fromZ, toZ)
  const maxZ =
    allowBlindAndBuriedVias === false ? layerCount - 1 : Math.max(fromZ, toZ)
  return Array.from({ length: maxZ - minZ + 1 }, (_, offset) => minZ + offset)
}

export const getPhysicalViaLayers = (params: {
  fromLayer: string
  toLayer: string
  layerCount: number
  allowBlindAndBuriedVias?: boolean
}): string[] => {
  const fromZ = mapLayerNameToZ(params.fromLayer, params.layerCount)
  const toZ = mapLayerNameToZ(params.toLayer, params.layerCount)
  if (fromZ === null || toZ === null) {
    return [...new Set([params.fromLayer, params.toLayer])]
  }
  return getPhysicalViaZLayers({ ...params, fromZ, toZ }).map((z) =>
    mapZToLayerName(z, params.layerCount),
  )
}
