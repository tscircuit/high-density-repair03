import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"

type PropertyCheck = {
  object: object
  key: PropertyKey
  descriptor: PropertyDescriptor | undefined
}
type PrototypeCheck = {
  object: object
  prototype: object | null
  keys: PropertyKey[]
  descriptors: Array<PropertyDescriptor | undefined>
}
type DataBudget = { properties: number; nodes: number }

const nativeOwnKeys = Reflect.ownKeys
const nativeApply = Reflect.apply
const nativeDescriptor = Object.getOwnPropertyDescriptor
const nativePrototype = Object.getPrototypeOf
const nativeFunctionSource = Function.prototype.toString
const nativeIsArray = Array.isArray
const nativeIsFinite = Number.isFinite
const nativeAbs = Math.abs
const nativeSet = Set
const objectPrototype = Object.prototype
const arrayPrototype = Array.prototype
const MAX_DATA_PROPERTIES = 200_000
const MAX_DATA_NODES = 50_000
const MAX_DATA_DEPTH = 24
const MAX_COORDINATE = 10_000
const SDK_NET_SOURCE =
  "getNetConnectedToId(id) {\n    return this.idToNetMap[id];\n  }"
const REQUIRED_SRJ_NUMBERS = ["layerCount", "minTraceWidth"] as const
const OPTIONAL_SRJ_NUMBERS = [
  "minViaDiameter",
  "minTraceToPadEdgeClearance",
  "minViaEdgeToPadEdgeClearance",
  "defaultObstacleMargin",
] as const
const BOUNDS_NUMBERS = ["minX", "maxX", "minY", "maxY"] as const
const OPTION_NUMBERS = ["traceClearance", "viaClearance"] as const
const POINT_NUMBERS = ["x", "y"] as const
const ROUTE_POINT_NUMBERS = ["x", "y", "z"] as const
const ROUTE_NUMBERS = ["traceThickness", "viaDiameter"] as const
const OBSTACLE_NUMBERS = ["width", "height"] as const

const propertyChecks: PropertyCheck[] = []
const prototypeChecks: PrototypeCheck[] = []

const captureProperty = (object: object, key: PropertyKey): void => {
  propertyChecks.push({
    object,
    key,
    descriptor: nativeDescriptor(object, key),
  })
}

const capturePrototype = (object: object): void => {
  const keys = nativeOwnKeys(object)
  prototypeChecks.push({
    object,
    prototype: nativePrototype(object),
    keys,
    descriptors: keys.map((key) => nativeDescriptor(object, key)),
  })
}

capturePrototype(objectPrototype)
capturePrototype(arrayPrototype)
captureProperty(arrayPrototype, "constructor")
for (const key of [
  "map",
  "flatMap",
  "reduce",
  "push",
  "filter",
  "some",
  "includes",
  "find",
  "sort",
  "at",
  Symbol.iterator,
]) {
  captureProperty(arrayPrototype, key)
}
captureProperty(Array, "from")
captureProperty(Array, "isArray")
captureProperty(Array, Symbol.species)
captureProperty(Object, "getOwnPropertyDescriptor")
for (const key of [
  "abs",
  "min",
  "max",
  "hypot",
  "sqrt",
  "floor",
  "ceil",
  "round",
  "cos",
  "sin",
  "clz32",
]) {
  captureProperty(Math, key)
}
for (const key of ["isInteger", "isFinite"]) captureProperty(Number, key)
for (const key of [
  "Object",
  "Number",
  "Boolean",
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "Uint8Array",
  "Uint32Array",
  "Math",
]) {
  captureProperty(globalThis, key)
}
for (const [prototype, keys] of [
  [Map.prototype, ["get", "set"]],
  [Set.prototype, ["has", "add", "delete", Symbol.iterator]],
  [WeakMap.prototype, ["get", "set"]],
] as const) {
  capturePrototype(prototype)
  for (const key of keys) captureProperty(prototype, key)
}
const arrayIteratorPrototype = nativePrototype([][Symbol.iterator]())
const setIteratorPrototype = nativePrototype(new Set()[Symbol.iterator]())
for (const prototype of [arrayIteratorPrototype, setIteratorPrototype]) {
  capturePrototype(prototype)
  captureProperty(prototype, "next")
  const iteratorPrototype = nativePrototype(prototype)
  capturePrototype(iteratorPrototype)
  captureProperty(iteratorPrototype, Symbol.iterator)
}
for (const prototype of [Uint8Array.prototype, Uint32Array.prototype]) {
  capturePrototype(prototype)
}
const typedArrayPrototype = nativePrototype(Uint32Array.prototype)
capturePrototype(typedArrayPrototype)
for (const key of ["length", "set", "fill"]) {
  captureProperty(typedArrayPrototype, key)
}

const haveNativeOperations = (): boolean => {
  // Check every prototype key before reading optional descriptor fields. An
  // added Object.prototype getter must never run during this eligibility gate.
  for (let index = 0; index < prototypeChecks.length; index++) {
    const check = prototypeChecks[index]!
    if (nativePrototype(check.object) !== check.prototype) return false
    const keys = nativeOwnKeys(check.object)
    if (keys.length !== check.keys.length) return false
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (keys[keyIndex] !== check.keys[keyIndex]) return false
    }
  }
  for (let index = 0; index < prototypeChecks.length; index++) {
    const check = prototypeChecks[index]!
    for (let keyIndex = 0; keyIndex < check.keys.length; keyIndex++) {
      const current = nativeDescriptor(check.object, check.keys[keyIndex]!)
      const original = check.descriptors[keyIndex]
      if (
        !current ||
        !original ||
        "value" in current !== "value" in original ||
        current.writable !== original.writable ||
        current.enumerable !== original.enumerable ||
        current.configurable !== original.configurable
      ) {
        return false
      }
    }
  }
  for (let index = 0; index < propertyChecks.length; index++) {
    const check = propertyChecks[index]!
    const current = nativeDescriptor(check.object, check.key)
    const original = check.descriptor
    if (
      !current ||
      !original ||
      current.value !== original.value ||
      current.get !== original.get ||
      current.set !== original.set ||
      current.writable !== original.writable ||
      current.enumerable !== original.enumerable ||
      current.configurable !== original.configurable
    ) {
      return false
    }
  }
  return true
}

const isPrimitiveData = (value: unknown): boolean => {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" &&
      nativeIsFinite(value) &&
      nativeAbs(value) <= MAX_COORDINATE)
  )
}

const isClosedData = (
  value: unknown,
  budget: DataBudget,
  visited: Set<object>,
  ancestors: Set<object>,
  depth: number,
): boolean => {
  if (value === null || typeof value !== "object") return isPrimitiveData(value)
  if (depth > MAX_DATA_DEPTH || ancestors.has(value)) return false
  if (visited.has(value)) return true
  budget.nodes++
  if (budget.nodes > MAX_DATA_NODES) return false
  const array = nativeIsArray(value)
  const prototype = nativePrototype(value)
  if (
    array
      ? prototype !== arrayPrototype
      : prototype !== objectPrototype && prototype !== null
  ) {
    return false
  }
  const keys = nativeOwnKeys(value)
  let length = 0
  if (array) {
    const descriptor = nativeDescriptor(value, "length")
    if (!descriptor || !("value" in descriptor)) return false
    length = descriptor.value as number
    if (keys.length !== length + 1) return false
  }
  ancestors.add(value)
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    budget.properties++
    if (budget.properties > MAX_DATA_PROPERTIES || typeof key !== "string") {
      return false
    }
    if (array && key !== "length") {
      const numericKey = +key
      if (
        numericKey < 0 ||
        numericKey >= length ||
        numericKey % 1 !== 0 ||
        `${numericKey}` !== key
      ) {
        return false
      }
    }
    const descriptor = nativeDescriptor(value, key)
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !isClosedData(descriptor.value, budget, visited, ancestors, depth + 1)
    ) {
      return false
    }
  }
  ancestors.delete(value)
  visited.add(value)
  return true
}

const resolveDescriptor = (
  object: object,
  key: PropertyKey,
): PropertyDescriptor | undefined => {
  let current: object | null = object
  for (let depth = 0; current && depth < MAX_DATA_DEPTH; depth++) {
    const descriptor = nativeDescriptor(current, key)
    if (descriptor) return descriptor
    current = nativePrototype(current)
  }
  return undefined
}

const hasNumericFields = (
  value: object,
  fields: readonly string[],
  required: boolean,
): boolean => {
  if (value === null || typeof value !== "object") return false
  for (let index = 0; index < fields.length; index++) {
    const current = (value as Record<string, unknown>)[fields[index]!]
    if (typeof current === "number") continue
    if (!required && (current === undefined || current === null)) continue
    return false
  }
  return true
}

const hasNumericGeometry = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): boolean => {
  if (
    !nativeIsArray(routes) ||
    !nativeIsArray(srj.obstacles) ||
    !srj.bounds ||
    typeof srj.bounds !== "object" ||
    !hasNumericFields(srj, REQUIRED_SRJ_NUMBERS, true) ||
    !hasNumericFields(srj, OPTIONAL_SRJ_NUMBERS, false) ||
    !hasNumericFields(srj.bounds, BOUNDS_NUMBERS, true) ||
    !hasNumericFields(RELAXED_DRC_OPTIONS, OPTION_NUMBERS, false)
  ) {
    return false
  }
  if (srj.outline !== undefined) {
    if (!nativeIsArray(srj.outline)) return false
    for (let index = 0; index < srj.outline.length; index++) {
      const point = srj.outline[index]
      if (!point || !hasNumericFields(point, POINT_NUMBERS, true)) return false
    }
  }
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index]
    if (
      !route ||
      typeof route !== "object" ||
      !nativeIsArray(route.route) ||
      !nativeIsArray(route.vias) ||
      typeof (route.rootConnectionName ?? route.connectionName) !== "string" ||
      !hasNumericFields(route, ROUTE_NUMBERS, false)
    ) {
      return false
    }
    for (let pointIndex = 0; pointIndex < route.route.length; pointIndex++) {
      const point = route.route[pointIndex]
      if (!point || !hasNumericFields(point, ROUTE_POINT_NUMBERS, true))
        return false
    }
    for (let viaIndex = 0; viaIndex < route.vias.length; viaIndex++) {
      const via = route.vias[viaIndex]
      if (!via || !hasNumericFields(via, POINT_NUMBERS, true)) return false
    }
  }
  for (let index = 0; index < srj.obstacles.length; index++) {
    const obstacle = srj.obstacles[index]
    if (
      !obstacle ||
      typeof obstacle !== "object" ||
      !obstacle.center ||
      !hasNumericFields(obstacle.center, POINT_NUMBERS, true) ||
      !hasNumericFields(obstacle, OBSTACLE_NUMBERS, true) ||
      !nativeIsArray(obstacle.layers)
    ) {
      return false
    }
    if (obstacle.zLayers !== undefined) {
      if (!nativeIsArray(obstacle.zLayers)) return false
      for (let zIndex = 0; zIndex < obstacle.zLayers.length; zIndex++) {
        if (typeof obstacle.zLayers[zIndex] !== "number") return false
      }
    }
    if (obstacle.connectedTo !== undefined) {
      if (!nativeIsArray(obstacle.connectedTo)) return false
      for (let idIndex = 0; idIndex < obstacle.connectedTo.length; idIndex++) {
        if (typeof obstacle.connectedTo[idIndex] !== "string") return false
      }
    }
  }
  return true
}

const hasClosedNetProvider = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  connMap: ConnectivityMap | undefined,
): boolean => {
  if (connMap === undefined) return true
  if (connMap === null || typeof connMap !== "object") return false
  const method = resolveDescriptor(connMap, "getNetConnectedToId")
  const dictionary = nativeDescriptor(connMap, "idToNetMap")
  if (
    !method ||
    !("value" in method) ||
    typeof method.value !== "function" ||
    nativeApply(nativeFunctionSource, method.value, []) !== SDK_NET_SOURCE ||
    !dictionary ||
    !("value" in dictionary) ||
    dictionary.value === null ||
    typeof dictionary.value !== "object"
  ) {
    return false
  }
  const idMap = dictionary.value as object
  const prototype = nativePrototype(idMap)
  if (prototype !== objectPrototype && prototype !== null) return false
  const keys = nativeOwnKeys(idMap)
  if (keys.length > MAX_DATA_PROPERTIES) return false
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    const descriptor = nativeDescriptor(idMap, key)
    if (
      typeof key !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !isPrimitiveData(descriptor.value)
    ) {
      return false
    }
  }
  const ids = new nativeSet<string>()
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index]!
    const id = route.rootConnectionName ?? route.connectionName
    if (typeof id !== "string") return false
    ids.add(id)
  }
  for (let index = 0; index < srj.obstacles.length; index++) {
    const connectedTo = srj.obstacles[index]!.connectedTo
    if (!connectedTo) continue
    for (let idIndex = 0; idIndex < connectedTo.length; idIndex++) {
      const id = connectedTo[idIndex]
      if (typeof id !== "string") return false
      ids.add(id)
    }
  }
  for (const id of ids) {
    const descriptor = resolveDescriptor(idMap, id)
    if (
      descriptor &&
      (!("value" in descriptor) || !isPrimitiveData(descriptor.value))
    ) {
      return false
    }
  }
  return true
}

// This certificate applies only to one synchronous, fully native broad call.
// Inspect descriptors before cloning so rejected hooks retain their old order.
export const hasClosedBroadForceContext = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
  effort: number,
  passMultiplier: number,
  connMap: ConnectivityMap | undefined,
  allowSameNetViaPairs: boolean,
  runFinalViaSegmentCleanup: boolean,
): boolean => {
  if (
    !haveNativeOperations() ||
    typeof effort !== "number" ||
    !nativeIsFinite(effort) ||
    typeof passMultiplier !== "number" ||
    !nativeIsFinite(passMultiplier) ||
    typeof allowSameNetViaPairs !== "boolean" ||
    typeof runFinalViaSegmentCleanup !== "boolean"
  ) {
    return false
  }
  const budget: DataBudget = { properties: 0, nodes: 0 }
  const visited = new nativeSet<object>()
  const ancestors = new nativeSet<object>()
  return (
    isClosedData(srj, budget, visited, ancestors, 0) &&
    isClosedData(routes, budget, visited, ancestors, 0) &&
    isClosedData(RELAXED_DRC_OPTIONS, budget, visited, ancestors, 0) &&
    srj !== null &&
    typeof srj === "object" &&
    hasNumericGeometry(srj, routes) &&
    hasClosedNetProvider(srj, routes, connMap)
  )
}
