import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../types/srj-types"

test("cached rotated pad geometry rejects contacts and retains clear traces in world coordinates", (): void => {
  for (const angle of [45, -30, 90]) {
    const cosine = Math.cos((angle * Math.PI) / 180)
    const sine = Math.sin((angle * Math.PI) / 180)
    const point = (x: number, y: number): { x: number; y: number } => ({
      x: 12 + x * cosine - y * sine,
      y: -4 + x * sine + y * cosine,
    })
    const trace = (id: string, y: number): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: id,
      route: [0.6, 0.8].map((x) => ({
        route_type: "wire" as const,
        ...point(x, y),
        width: 0.1,
        layer: "top",
      })),
    })
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: 8, maxX: 16, minY: -8, maxY: 0 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 12, y: -4 },
          width: 2,
          height: 0.2,
          ccwRotationDegrees: angle,
          layers: ["top"],
          connectedTo: ["pcb_smtpad_rotated", "pad-net"],
        },
      ],
    }
    const control = new AutoroutingDrcEngine(srj)
    const cached = new AutoroutingDrcEngine(srj, {
      cacheStaticObstacleNetMembership: true,
      cacheImmutableTraceGeometry: true,
      useConservativeRectObstaclePrecheck: true,
      useTransientDynamicQueryMarkers: true,
    })
    const clear = trace("clear", 0.4)
    const colliding = trace("colliding", 0)
    expect(control.evaluate([clear]).errors).toEqual([])
    expect(control.evaluate([colliding]).errors).toHaveLength(1)
    for (const routes of [[clear], [colliding], [clear, colliding], [clear]]) {
      expect(cached.evaluate(routes)).toEqual(control.evaluate(routes))
      expect(cached.evaluate(routes)).toEqual(control.evaluate(routes))
    }
  }
})
