import { expect, test } from "bun:test"
import { getDrcErrors } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"

test("getDrcErrors resolves centers from via error IDs when pcb_via_id contains underscores", () => {
  const circuitJson = [
    {
      type: "source_trace" as const,
      source_trace_id: "source_trace_0",
      connected_source_port_ids: ["port_0", "port_1"],
      connected_source_net_ids: [],
    },
    {
      type: "pcb_trace" as const,
      pcb_trace_id: "trace_0",
      source_trace_id: "source_trace_0",
      route: [
        {
          route_type: "wire" as const,
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top" as const,
        },
        {
          route_type: "wire" as const,
          x: 0.2,
          y: 0,
          width: 0.1,
          layer: "top" as const,
        },
      ],
    },
    {
      type: "pcb_via" as const,
      pcb_via_id: "via_0",
      pcb_trace_id: "trace_0",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top" as const, "bottom" as const],
    },
    {
      type: "pcb_via" as const,
      pcb_via_id: "via_1",
      pcb_trace_id: "trace_0",
      x: 0.2,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top" as const, "bottom" as const],
    },
  ]

  const result = getDrcErrors(circuitJson)
  const viaError = result.locationAwareErrors.find(
    (error) =>
      "pcb_error_id" in error &&
      error.pcb_error_id === "same_net_vias_close_via_0_via_1",
  )

  expect(viaError).toBeDefined()
  expect(viaError?.center).toEqual({ x: 0.1, y: 0 })
})
