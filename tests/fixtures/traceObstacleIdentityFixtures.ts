import {
  AutoroutingDrcEngine,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "../../lib"
import { getDrcSnapshot } from "../../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

export const identitySrj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -2, maxX: 5, maxY: 2 },
  connections: ["net_a", "net_b"].map((name) => ({
    name,
    rootConnectionName: "shared_net",
    pointsToConnect: [],
  })),
  obstacles: [0, 3].map((x, index) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [`pcb_smtpad_${index}`],
  })),
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
}

export const identityRoute = ({
  connectionName = "net_a",
  startX = -1,
  endX = 1,
  y = 0.52,
}: {
  connectionName?: string
  startX?: number
  endX?: number
  y?: number
} = {}): HighDensityRoute => ({
  connectionName,
  route: [
    { x: startX, y, z: 0 },
    { x: endX, y, z: 0 },
  ],
  vias: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
})

export const identitySnapshot = (routes: HighDensityRoute[]) =>
  getDrcSnapshot(
    identitySrj,
    routes,
    undefined,
    undefined,
    new AutoroutingDrcEngine(identitySrj, { traceClearance: 0 }),
  )
