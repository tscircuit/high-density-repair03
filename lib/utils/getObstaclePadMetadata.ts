import type { Obstacle } from "../types"

type Point = { x: number; y: number }

/** Resolve pad provenance and the nearest declared port, not arbitrary net ids. */
export const getObstaclePadMetadata = (
  obstacle: Obstacle,
  declaredPcbPortIds: Set<string>,
  portPositionMap: Map<string, Point>,
) => {
  const metadata = obstacle.circuitJsonMetadata
  const smtPadId =
    metadata?.pcb_smtpad_id ??
    obstacle.connectedTo.find((id) => id.startsWith("pcb_smtpad_"))
  const platedHoleId =
    metadata?.pcb_plated_hole_id ??
    obstacle.connectedTo.find((id) => id.startsWith("pcb_plated_hole_"))
  const viaId =
    metadata?.pcb_via_id ??
    obstacle.connectedTo.find((id) => id.startsWith("pcb_via_"))
  const metadataPortId =
    metadata?.pcb_port_id ??
    obstacle.connectedTo.find((id) => id.startsWith("pcb_port_"))
  const candidatePortIds = [
    ...new Set([
      ...(metadataPortId ? [metadataPortId] : []),
      ...obstacle.connectedTo.filter((id) => declaredPcbPortIds.has(id)),
    ]),
  ]
  let pcbPortId = candidatePortIds[0]
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidateId of candidatePortIds) {
    const position = portPositionMap.get(candidateId)
    if (!position) continue
    const distance = Math.hypot(
      position.x - obstacle.center.x,
      position.y - obstacle.center.y,
    )
    if (distance < nearestDistance) {
      nearestDistance = distance
      pcbPortId = candidateId
    }
  }
  return { smtPadId, platedHoleId, pcbPortId, viaId }
}
