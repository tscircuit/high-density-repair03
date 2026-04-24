import type { ConnectionPoint, SimplifiedPcbTrace } from "../types"
import { getConnectionPointLayers } from "../types/srj-types"
import { mapZToLayerName } from "./mapZToLayerName"

type RoutePoint = {
  x: number
  y: number
  z: number
  pcb_port_id?: string
}

type SimplifiedRouteSegment = SimplifiedPcbTrace["route"][number]
type SimplifiedWireSegment = Extract<
  SimplifiedRouteSegment,
  { route_type: "wire" }
>

const POSITION_EPSILON = 1e-6

const areSameXY = (
  left: { x: number; y: number },
  right: { x: number; y: number },
) =>
  Math.abs(left.x - right.x) <= POSITION_EPSILON &&
  Math.abs(left.y - right.y) <= POSITION_EPSILON

export const convertHdRouteToSimplifiedRoute = (
  route: RoutePoint[],
  layerCount: number,
  options?: {
    traceThickness?: number
    viaDiameter?: number
    connectionPoints?: ConnectionPoint[]
  },
): SimplifiedPcbTrace["route"] => {
  if (route.length === 0) return []

  const width = options?.traceThickness ?? 0.1
  const firstPoint = route[0]!
  const lastPoint = route.at(-1)!
  const getPortIdForEndpoint = (routePoint: RoutePoint) => {
    if (routePoint.pcb_port_id) return routePoint.pcb_port_id

    const routeLayer = mapZToLayerName(routePoint.z, layerCount)
    return options?.connectionPoints?.find(
      (connectionPoint) =>
        connectionPoint.pcb_port_id &&
        areSameXY(connectionPoint, routePoint) &&
        getConnectionPointLayers(connectionPoint).includes(routeLayer),
    )?.pcb_port_id
  }
  const startPcbPortId = getPortIdForEndpoint(firstPoint)
  const endPcbPortId = getPortIdForEndpoint(lastPoint)
  const firstWire: SimplifiedWireSegment = {
    route_type: "wire",
    x: firstPoint.x,
    y: firstPoint.y,
    width,
    layer: mapZToLayerName(firstPoint.z, layerCount),
    ...(startPcbPortId ? { start_pcb_port_id: startPcbPortId } : {}),
    ...(route.length === 1 && endPcbPortId
      ? { end_pcb_port_id: endPcbPortId }
      : {}),
  }
  const simplifiedRoute: SimplifiedPcbTrace["route"] = [firstWire]

  for (let index = 1; index < route.length; index += 1) {
    const previousPoint = route[index - 1]
    const currentPoint = route[index]
    if (!previousPoint || !currentPoint) continue

    if (
      previousPoint.z !== currentPoint.z &&
      previousPoint.x === currentPoint.x &&
      previousPoint.y === currentPoint.y
    ) {
      simplifiedRoute.push({
        route_type: "via",
        x: currentPoint.x,
        y: currentPoint.y,
        from_layer: mapZToLayerName(previousPoint.z, layerCount),
        to_layer: mapZToLayerName(currentPoint.z, layerCount),
        ...(options?.viaDiameter ? { via_diameter: options.viaDiameter } : {}),
      })
      continue
    }

    simplifiedRoute.push({
      route_type: "wire",
      x: currentPoint.x,
      y: currentPoint.y,
      width,
      layer: mapZToLayerName(currentPoint.z, layerCount),
      ...(index === route.length - 1 && endPcbPortId
        ? { end_pcb_port_id: endPcbPortId }
        : {}),
    })
  }

  return simplifiedRoute
}
