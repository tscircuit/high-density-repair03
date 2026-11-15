import type { GetDrcErrorsOptions } from "../../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import type { Point } from "../../lib/solvers/GlobalDrcForceImproveSolver/internalTypes"
import {
  createClosedForceCase,
  type ClosedForceCase,
} from "./createClosedForceCase"

const nativeObject = Object
const nativeDescriptor = Object.getOwnPropertyDescriptor
const nativeDefine = Object.defineProperty
const globalObjectDescriptor = nativeDescriptor(globalThis, "Object")!
const descriptorMethodDescriptor = nativeDescriptor(
  nativeObject,
  "getOwnPropertyDescriptor",
)!

export const BOARD_CLOSED_FORCE_VARIANTS = [
  "native",
  "descriptor-method",
  "descriptor-getter",
  "global-object-getter",
  "descriptor-clone-mutation",
] as const

export const createBoardClosedForceCase = (
  variant: string,
  options: GetDrcErrorsOptions,
): ClosedForceCase => {
  const fixture = createClosedForceCase("native-provider", options)
  fixture.srj.outline = [
    { x: -3, y: -2 },
    { x: 3, y: -2 },
    { x: 3, y: 2 },
    { x: -3, y: 2 },
    { x: -3, y: -2 },
  ]
  const activate = fixture.activate
  const restore = fixture.restore
  let clonedPoint: Point | undefined
  let mutated = false
  const descriptor = (
    object: object,
    key: PropertyKey,
  ): PropertyDescriptor | undefined => {
    fixture.events.push(`descriptor:${String(key)}`)
    const result = nativeDescriptor(object, key)
    if (variant === "descriptor-clone-mutation") {
      if (key === "route" && Array.isArray(result?.value)) {
        clonedPoint = (result.value as Point[])[1]
      }
      if (object === clonedPoint && key === "x" && !mutated) {
        clonedPoint.x += 0.25
        mutated = true
        fixture.events.push("mutate-cloned-point")
        return nativeDescriptor(object, key)
      }
    }
    return result
  }
  fixture.activate = (): void => {
    activate()
    if (
      variant === "descriptor-method" ||
      variant === "descriptor-clone-mutation"
    ) {
      nativeDefine(nativeObject, "getOwnPropertyDescriptor", {
        ...descriptorMethodDescriptor,
        value: descriptor,
      })
    }
    if (variant === "descriptor-getter") {
      nativeDefine(nativeObject, "getOwnPropertyDescriptor", {
        configurable: descriptorMethodDescriptor.configurable,
        enumerable: descriptorMethodDescriptor.enumerable,
        get: (): typeof descriptor => {
          fixture.events.push("descriptor-getter")
          return descriptor
        },
      })
    }
    if (variant === "global-object-getter") {
      nativeDefine(globalThis, "Object", {
        configurable: globalObjectDescriptor.configurable,
        enumerable: globalObjectDescriptor.enumerable,
        get: (): ObjectConstructor => {
          fixture.events.push("global-object-getter")
          return nativeObject
        },
      })
    }
  }
  fixture.restore = (): void => {
    nativeDefine(globalThis, "Object", globalObjectDescriptor)
    nativeDefine(
      nativeObject,
      "getOwnPropertyDescriptor",
      descriptorMethodDescriptor,
    )
    restore()
  }
  return fixture
}
