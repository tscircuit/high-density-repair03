import {
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { CircuitJson } from "circuit-json"

type SmtPad = Extract<CircuitJson[number], { type: "pcb_smtpad" }>
type Via = Extract<CircuitJson[number], { type: "pcb_via" }>

const getViaPadGapMm = (via: Via, pad: SmtPad): number => {
  if (pad.shape === "rect") {
    return (
      Math.hypot(
        Math.max(0, Math.abs(via.x - pad.x) - pad.width / 2),
        Math.max(0, Math.abs(via.y - pad.y) - pad.height / 2),
      ) -
      via.outer_diameter / 2
    )
  }
  if (pad.shape !== "polygon") throw new Error("Unexpected terminal pad shape")
  const distanceMm = Math.min(
    ...pad.points.map((point, index) =>
      pointToSegmentDistance(
        via,
        point,
        pad.points[(index + 1) % pad.points.length]!,
      ),
    ),
  )
  return (
    (isPointInsidePolygon(via, pad.points) ? -distanceMm : distanceMm) -
    via.outer_diameter / 2
  )
}

export const getTerminalViaGaps = (circuitJson: CircuitJson): number[] => {
  const terminalPorts = circuitJson.filter(
    (element) =>
      element.type === "source_port" &&
      (element.name === "B4A9" || element.name === "pin1"),
  )
  const fuse = circuitJson.find(
    (element) =>
      element.type === "source_component" && element.name === "F_VBUS",
  )
  if (fuse?.type !== "source_component") throw new Error("Missing real fuse")
  const pcbPorts = circuitJson
    .filter((element) => element.type === "pcb_port")
    .filter((pcbPort) =>
      terminalPorts.some(
        (port) =>
          port.type === "source_port" &&
          port.source_port_id === pcbPort.source_port_id &&
          (port.name === "B4A9" ||
            port.source_component_id === fuse.source_component_id),
      ),
    )
  const pads = circuitJson
    .filter((element) => element.type === "pcb_smtpad")
    .filter((pad) =>
      pcbPorts.some((port) => port.pcb_port_id === pad.pcb_port_id),
    )
  if (pads.length !== 2) throw new Error("Missing connector/fuse terminal pads")
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  return pads.map((pad) =>
    Math.min(...vias.map((via) => getViaPadGapMm(via, pad))),
  )
}
