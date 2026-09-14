import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "../lib/drc/AutoroutingDrcEngine"
import { getDrcErrors } from "../lib/solvers/GlobalDrcForceImproveSolver/getDrcErrors"
import { getConnMapAwareSrj } from "../lib/solvers/GlobalDrcForceImproveSolver/netUtils"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"
import { convertToCircuitJson } from "../lib/utils/convertToCircuitJson"

test("declared root nets join shared branches without hiding foreign pad contacts", () => {
  const sharedPort = {
    x: 0,
    y: 0,
    layer: "top",
    pcb_port_id: "pcb_port_81",
  }
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [
      {
        name: "source_net_6_mst0",
        __rootConnectionNames: ["source_net_6", "source_trace_shared"],
        pointsToConnect: [
          sharedPort,
          { x: 3, y: 0, layer: "top", pcb_port_id: "pcb_port_right" },
        ],
      },
      {
        name: "source_net_6_mst1",
        __rootConnectionNames: ["source_net_6", "source_trace_shared"],
        pointsToConnect: [
          sharedPort,
          { x: 0, y: 3, layer: "top", pcb_port_id: "pcb_port_top" },
        ],
      },
      {
        name: "source_net_foreign_mst0",
        __rootConnectionNames: ["source_net_foreign"],
        pointsToConnect: [
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_foreign" },
          { x: 2, y: -3, layer: "top", pcb_port_id: "pcb_port_foreign_end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_port_81"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "shared_pad",
          pcb_port_id: "pcb_port_81",
        },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["source_trace_shared"],
        circuitJsonMetadata: { pcb_smtpad_id: "secondary_root_pad" },
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_port_foreign"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "foreign_pad",
          pcb_port_id: "pcb_port_foreign",
        },
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "branch_right",
      connection_name: "source_net_6_mst0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "pcb_port_81",
        },
        {
          route_type: "wire",
          x: 3,
          y: 0,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "pcb_port_right",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "branch_top",
      connection_name: "source_net_6_mst1",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "pcb_port_81",
        },
        {
          route_type: "wire",
          x: 0,
          y: 3,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "pcb_port_top",
        },
      ],
    },
  ]
  const circuitJson = convertToCircuitJson(srj, traces)
  const referenceErrors = getDrcErrors(circuitJson).errors
  const indexedErrors = new AutoroutingDrcEngine(srj).evaluate(traces).errors

  expect(referenceErrors).toHaveLength(1)
  expect(indexedErrors).toHaveLength(1)
  expect(referenceErrors[0]?.type).toBe("pcb_trace_error")
  expect(indexedErrors[0]?.pcb_trace_error_id).toBe(
    "overlap_branch_right_foreign_pad",
  )
  const referenceErrorIds = referenceErrors.map((error) =>
    "pcb_trace_error_id" in error ? error.pcb_trace_error_id : error.type,
  )
  expect(indexedErrors.map((error) => error.pcb_trace_error_id)).toEqual(
    referenceErrorIds,
  )
  expect(
    circuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => trace.source_trace_id),
  ).toEqual(["source_net_6", "source_net_6"])
  expect(
    circuitJson
      .filter((element) => element.type === "source_trace")
      .map((trace) => trace.source_trace_id),
  ).toEqual(["source_net_6", "source_net_foreign"])

  const sameNetOnlySrj = {
    ...srj,
    obstacles: srj.obstacles.slice(0, 2),
  }
  expect(
    getDrcErrors(convertToCircuitJson(sameNetOnlySrj, traces)).errors,
  ).toEqual([])
  expect(
    new AutoroutingDrcEngine(sameNetOnlySrj).evaluate(traces).errors,
  ).toEqual([])

  const connMap = new ConnectivityMap({})
  connMap.addConnections([["source_net_6", "declared_map_net"]])
  const mappedSrj = getConnMapAwareSrj(srj, connMap)
  expect(mappedSrj.connections[0]?.netConnectionName).toBe(
    connMap.getNetConnectedToId("source_net_6"),
  )
  expect(mappedSrj.connections[1]?.netConnectionName).toBe(
    mappedSrj.connections[0]?.netConnectionName,
  )
  expect(mappedSrj.connections[2]?.netConnectionName).toBeUndefined()
})
