import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { GlobalDrcForceImproveSolver } from "../lib"

export default (
  <GenericSolverDebugger
    createSolver={() =>
      new GlobalDrcForceImproveSolver({
        srj: {
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          connections: [],
          obstacles: [],
          layerCount: 2,
          minTraceWidth: 0.1,
          minViaDiameter: 0.3,
          defaultObstacleMargin: 0.1,
        },
        hdRoutes: [],
      })
    }
  />
)
