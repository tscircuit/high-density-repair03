import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GetDrcErrorsOptions } from "../../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import type { SimpleRouteJson } from "../../lib/types"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

export type ClosedForceCase = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap | undefined
  effort: number
  events: string[]
  activate: () => void
  restore: () => void
}

export const CLOSED_FORCE_VARIANTS = [
  "plain",
  "native-provider",
  "merged-provider",
  "null-prototype-provider",
  "provider-prototype-name",
  "custom-provider",
  "provider-method-getter",
  "provider-id-getter",
  "provider-inherited-id",
  "point-getter",
  "clearance-getter",
  "own-map",
  "array-map",
  "array-species",
  "array-iterator",
  "array-iterator-next",
  "set-iterator-next",
  "array-numeric-setter",
  "object-descriptor-getter",
  "math-hypot",
  "effort-coercion",
  "numeric-slot-coercion",
  "margin-slot-coercion",
  "escaped-clone-mutation",
] as const

const nativeMap = Array.prototype.map
const nativeHypot = Math.hypot
const nativeJoin = Array.prototype.join
const nativeDefine = Object.defineProperty
const nativeDescriptor = Object.getOwnPropertyDescriptor
const nativePrototype = Object.getPrototypeOf
const nativeApply = Reflect.apply
const arrayIteratorPrototype = nativePrototype([][Symbol.iterator]())
const setIteratorPrototype = nativePrototype(new Set()[Symbol.iterator]())

export const createClosedForceCase = (
  variant: string,
  options: GetDrcErrorsOptions,
): ClosedForceCase => {
  const events: string[] = ["start"]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.5 },
        width: 0.8,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "left",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0.5, z: 0 },
        { x: -0.5, y: 0.15, z: 0 },
        { x: 0.5, y: 0.15, z: 0 },
        { x: 2, y: 0.5, z: 0 },
      ],
    },
    {
      connectionName: "right",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0.3, z: 0 },
        { x: -0.5, y: 0.13, z: 0 },
        { x: 0.5, y: 0.13, z: 0 },
        { x: 2, y: 0.3, z: 0 },
      ],
    },
  ]
  const restores: Array<() => void> = []
  const replace = (
    object: object,
    key: PropertyKey,
    descriptor: PropertyDescriptor,
  ): void => {
    const original = nativeDescriptor(object, key)
    nativeDefine(object, key, { configurable: true, ...descriptor })
    restores.push(() => {
      if (original) nativeDefine(object, key, original)
      else Reflect.deleteProperty(object, key)
    })
  }
  let connMap: ConnectivityMap | undefined
  if (variant.includes("provider")) {
    connMap = new ConnectivityMap({
      left: ["left", "left-net"],
      right: ["right", "right-net"],
      pad: ["foreign-pad", "pad-net"],
    })
    if (variant === "merged-provider") {
      connMap.addConnections([["left", "right"]])
    }
    if (variant === "null-prototype-provider") {
      connMap.idToNetMap = Object.assign(
        Object.create(null),
        connMap.idToNetMap,
      )
    }
    if (variant === "provider-prototype-name") {
      routes[0]!.connectionName = "__proto__"
    }
  }
  const fixture: ClosedForceCase = {
    srj,
    routes,
    connMap,
    effort: 1,
    events,
    activate: () => {
      if (variant === "custom-provider" && connMap) {
        replace(connMap, "getNetConnectedToId", {
          value: (id: string): string | undefined => {
            events.push(`net:${id}`)
            return id === "left" ? "right-net" : "foreign-net"
          },
        })
      }
      if (variant === "provider-method-getter" && connMap) {
        const resolver = connMap.getNetConnectedToId
        replace(connMap, "getNetConnectedToId", {
          get: () => {
            events.push("net-method")
            return resolver
          },
        })
      }
      if (variant === "provider-id-getter" && connMap) {
        replace(connMap.idToNetMap, "left", {
          get: () => {
            events.push("net-left")
            return "right-net"
          },
        })
      }
      if (variant === "provider-inherited-id" && connMap) {
        const original = connMap.idToNetMap
        connMap.idToNetMap = Object.assign(
          Object.create({ left: "right-net" }),
          { right: "right-net", "foreign-pad": "pad-net" },
        )
        restores.push(() => {
          connMap!.idToNetMap = original
        })
      }
      if (variant === "point-getter") {
        replace(routes[0]!.route[1]!, "x", {
          enumerable: true,
          get: () => {
            events.push("point.x")
            return -0.5
          },
        })
      }
      if (variant === "clearance-getter") {
        replace(options, "traceClearance", {
          enumerable: true,
          get: () => {
            events.push("traceClearance")
            return 0.1 + (events.length % 3) * 0.00001
          },
        })
      }
      if (variant === "own-map" || variant === "array-map") {
        replace(variant === "own-map" ? routes : Array.prototype, "map", {
          value: function (this: unknown[], ...args: unknown[]): unknown {
            events.push("map")
            return nativeApply(nativeMap, this, args)
          },
        })
      }
      if (variant === "array-species") {
        replace(Array, Symbol.species, {
          get: () => {
            events.push("species")
            return Array
          },
        })
      }
      if (variant === "array-iterator") {
        const iterator = Array.prototype[Symbol.iterator]
        replace(Array.prototype, Symbol.iterator, {
          value: function (this: unknown[]): unknown {
            events.push("array-iterator")
            return nativeApply(iterator, this, [])
          },
        })
      }
      if (
        variant === "array-iterator-next" ||
        variant === "set-iterator-next"
      ) {
        const prototype =
          variant === "array-iterator-next"
            ? arrayIteratorPrototype
            : setIteratorPrototype
        const next = nativeDescriptor(prototype, "next")!.value
        replace(prototype, "next", {
          value: function (this: object): unknown {
            events.push(variant)
            return nativeApply(next, this, [])
          },
        })
      }
      if (variant === "array-numeric-setter") {
        replace(Array.prototype, "0", {
          set: function (this: object, value: unknown): void {
            events.push("array.0")
            nativeDefine(this, "0", {
              configurable: true,
              enumerable: true,
              writable: true,
              value,
            })
          },
        })
      }
      if (variant === "object-descriptor-getter") {
        replace(Object.prototype, "value", {
          get: () => {
            events.push("descriptor.value")
            return 0
          },
        })
      }
      if (variant === "math-hypot") {
        replace(Math, "hypot", {
          value: (...values: number[]): number => {
            events.push("hypot")
            return nativeHypot(...values)
          },
        })
      }
      if (variant === "effort-coercion") {
        fixture.effort = {
          valueOf: (): number => {
            events.push("effort")
            return 1
          },
        } as unknown as number
      }
      if (
        variant === "numeric-slot-coercion" ||
        variant === "margin-slot-coercion"
      ) {
        if (variant === "numeric-slot-coercion") {
          routes[0]!.traceThickness = [] as unknown as number
        } else {
          srj.defaultObstacleMargin = [] as unknown as number
        }
        replace(Array.prototype, "join", {
          value: function (this: unknown[], ...args: unknown[]): unknown {
            events.push("join")
            return nativeApply(nativeJoin, this, args)
          },
        })
      }
      if (variant === "escaped-clone-mutation") {
        let escapedPoints: HighDensityRoute["route"] | undefined
        replace(Array.prototype, "map", {
          value: function (this: unknown[], ...args: unknown[]): unknown {
            const result = nativeApply(nativeMap, this, args)
            if (this === routes[0]!.route) {
              events.push("capture-clone")
              escapedPoints = result as HighDensityRoute["route"]
            }
            return result
          },
        })
        replace(options, "traceClearance", {
          enumerable: true,
          get: () => {
            events.push("mutate-clone")
            if (escapedPoints) escapedPoints[1]!.x += 0.000001
            return 0.1
          },
        })
      }
    },
    restore: () => {
      for (let index = restores.length - 1; index >= 0; index--) {
        restores[index]!()
      }
    },
  }
  return fixture
}
