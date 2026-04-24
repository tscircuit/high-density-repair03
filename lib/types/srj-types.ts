import type {
  ConnectionPoint,
  MultiLayerConnectionPoint,
  SingleLayerConnectionPoint,
} from "../../types/srj-types"

export type {
  ConnectionPoint,
  Jumper,
  JumperType,
  MultiLayerConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
  SingleLayerConnectionPoint,
  TerminalViaHint,
} from "../../types/srj-types"

export const isSingleLayerConnectionPoint = (
  point: ConnectionPoint,
): point is SingleLayerConnectionPoint => "layer" in point

export const isMultiLayerConnectionPoint = (
  point: ConnectionPoint,
): point is MultiLayerConnectionPoint => "layers" in point

export const getConnectionPointLayer = (
  point: ConnectionPoint,
): string | undefined =>
  isSingleLayerConnectionPoint(point) ? point.layer : point.layers[0]

export const getConnectionPointLayers = (point: ConnectionPoint): string[] =>
  isSingleLayerConnectionPoint(point) ? [point.layer] : point.layers
