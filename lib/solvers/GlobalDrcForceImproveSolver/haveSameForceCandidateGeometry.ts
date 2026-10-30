import type { HighDensityRoute } from "../../types/high-density-types"

/** Compare successive force proposals from the same incumbent without hashing. */
export const haveSameForceCandidateGeometry = (
  left: HighDensityRoute[],
  right: HighDensityRoute[],
): boolean => {
  if (left.length !== right.length) return false
  for (let routeIndex = 0; routeIndex < left.length; routeIndex++) {
    const a = left[routeIndex]!
    const b = right[routeIndex]!
    if (
      a.connectionName !== b.connectionName ||
      a.rootConnectionName !== b.rootConnectionName ||
      a.traceThickness !== b.traceThickness ||
      a.viaDiameter !== b.viaDiameter ||
      a.jumpers !== b.jumpers ||
      a.route.length !== b.route.length ||
      a.vias.length !== b.vias.length
    ) {
      return false
    }
    for (let pointIndex = 0; pointIndex < a.route.length; pointIndex++) {
      const p = a.route[pointIndex]!
      const q = b.route[pointIndex]!
      if (
        p.x !== q.x ||
        p.y !== q.y ||
        p.z !== q.z ||
        p.pcb_port_id !== q.pcb_port_id ||
        p.insideJumperPad !== q.insideJumperPad ||
        p.toNextSegmentType !== q.toNextSegmentType
      ) {
        return false
      }
    }
    for (let viaIndex = 0; viaIndex < a.vias.length; viaIndex++) {
      if (
        a.vias[viaIndex]!.x !== b.vias[viaIndex]!.x ||
        a.vias[viaIndex]!.y !== b.vias[viaIndex]!.y
      ) {
        return false
      }
    }
  }
  return true
}
