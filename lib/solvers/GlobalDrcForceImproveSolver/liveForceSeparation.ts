import type { SimpleRouteJson } from "../../types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import type { Point, Segment } from "./internalTypes"
import { CLEARANCE_SLACK, COORDINATE_EPSILON } from "./solverConfig"

// Bounded coordinates keep projection products finite and their rounding error
// well below the extra coordinate epsilon used for these strict certificates.
const MAX_CERTIFIED_COORDINATE = 10_000

type GetterLookup = {
  __lookupGetter__?: (this: object, key: string) => (() => unknown) | undefined
}

const nativeHasOwnProperty = Object.prototype.hasOwnProperty
const nativeLookupGetter = (Object.prototype as GetterLookup).__lookupGetter__

const readOwnDataValue = (value: object, key: string): unknown => {
  if (typeof nativeLookupGetter === "function") {
    if (
      !nativeHasOwnProperty.call(value, key) ||
      nativeLookupGetter.call(value, key) !== undefined
    ) {
      return undefined
    }
    return (value as Record<string, unknown>)[key]
  }
  // Older runtimes keep the same eligibility check through descriptors.
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

const hasBoundedDataCoordinates = (point: object): boolean => {
  const x = readOwnDataValue(point, "x")
  const y = readOwnDataValue(point, "y")
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= MAX_CERTIFIED_COORDINATE &&
    Math.abs(y) <= MAX_CERTIFIED_COORDINATE
  )
}

const hasBoundedDataEndpoints = (segment: Segment): boolean => {
  const start = readOwnDataValue(segment, "start")
  const end = readOwnDataValue(segment, "end")
  return (
    start !== null &&
    end !== null &&
    typeof start === "object" &&
    typeof end === "object" &&
    hasBoundedDataCoordinates(start) &&
    hasBoundedDataCoordinates(end)
  )
}

export const areLiveSegmentPairForcesSeparated = (
  left: Segment,
  right: Segment,
): boolean => {
  const leftRadius = readOwnDataValue(left, "radius")
  const rightRadius = readOwnDataValue(right, "radius")
  const clearance = readOwnDataValue(RELAXED_DRC_OPTIONS, "traceClearance")
  if (
    typeof leftRadius !== "number" ||
    typeof rightRadius !== "number" ||
    typeof clearance !== "number" ||
    !Number.isFinite(leftRadius) ||
    !Number.isFinite(rightRadius) ||
    !Number.isFinite(clearance) ||
    leftRadius < 0 ||
    rightRadius < 0 ||
    clearance < 0 ||
    !hasBoundedDataEndpoints(left) ||
    !hasBoundedDataEndpoints(right)
  ) {
    return false
  }
  const requiredDistance = leftRadius + rightRadius + clearance + CLEARANCE_SLACK
  if (!Number.isFinite(requiredDistance)) return false
  const threshold = requiredDistance + COORDINATE_EPSILON

  // Segment endpoints stay live as earlier force pairs move the shared points.
  return (
    Math.min(left.start.x, left.end.x) -
      Math.max(right.start.x, right.end.x) >
      threshold ||
    Math.min(right.start.x, right.end.x) -
      Math.max(left.start.x, left.end.x) >
      threshold ||
    Math.min(left.start.y, left.end.y) -
      Math.max(right.start.y, right.end.y) >
      threshold ||
    Math.min(right.start.y, right.end.y) -
      Math.max(left.start.y, left.end.y) >
      threshold
  )
}

export const areLiveSegmentRectForcesSeparated = (
  segment: Segment,
  obstacle: SimpleRouteJson["obstacles"][number],
  requiredDistance: number,
): boolean => {
  const center = readOwnDataValue(obstacle, "center")
  const width = readOwnDataValue(obstacle, "width")
  const height = readOwnDataValue(obstacle, "height")
  if (
    center === null ||
    typeof center !== "object" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0 ||
    width > MAX_CERTIFIED_COORDINATE ||
    height > MAX_CERTIFIED_COORDINATE ||
    !Number.isFinite(requiredDistance) ||
    requiredDistance < 0 ||
    !hasBoundedDataCoordinates(center) ||
    !hasBoundedDataEndpoints(segment)
  ) {
    return false
  }
  const threshold = requiredDistance + COORDINATE_EPSILON
  const halfWidth = width / 2
  const halfHeight = height / 2
  const point = center as Point
  return (
    Math.min(segment.start.x, segment.end.x) -
      (point.x + halfWidth) >
      threshold ||
    point.x - halfWidth -
      Math.max(segment.start.x, segment.end.x) >
      threshold ||
    Math.min(segment.start.y, segment.end.y) -
      (point.y + halfHeight) >
      threshold ||
    point.y - halfHeight -
      Math.max(segment.start.y, segment.end.y) >
      threshold
  )
}
