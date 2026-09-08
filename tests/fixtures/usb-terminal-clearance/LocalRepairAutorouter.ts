import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type SimpleRouteJson as RouterSimpleRouteJson,
} from "@tscircuit/capacity-autorouter"
import type {
  AutorouterCompleteEvent,
  AutorouterErrorEvent,
  AutorouterProgressEvent,
  GenericLocalAutorouter,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/core"
import { GlobalDrcBranchPortfolioSolver } from "../../../lib"

type AutorouterEvents = {
  complete: AutorouterCompleteEvent
  error: AutorouterErrorEvent
  progress: AutorouterProgressEvent
}

export class LocalRepairAutorouter implements GenericLocalAutorouter {
  isRouting = false
  readonly pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph
  readonly repairs: GlobalDrcBranchPortfolioSolver[] = []
  private listeners: {
    [Event in keyof AutorouterEvents]: Array<
      (event: AutorouterEvents[Event]) => void
    >
  } = { complete: [], error: [], progress: [] }

  constructor(readonly input: SimpleRouteJson) {
    this.pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      input as RouterSimpleRouteJson,
      { effort: 10, cacheProvider: null },
    )
  }

  on<Event extends keyof AutorouterEvents>(
    event: Event,
    listener: (event: AutorouterEvents[Event]) => void,
  ): void {
    this.listeners[event].push(listener)
  }

  start(): void {
    this.isRouting = true
    try {
      const traces = this.solveSync()
      this.isRouting = false
      for (const listener of this.listeners.complete)
        listener({ type: "complete", traces })
    } catch (error) {
      this.isRouting = false
      for (const listener of this.listeners.error)
        listener({
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        })
    }
  }

  stop(): void {
    this.isRouting = false
  }

  solveSync(): SimplifiedPcbTrace[] {
    while (!this.pipeline.solved && !this.pipeline.failed) {
      const joint = this.pipeline.pipeline9JointDrcRepairSolver
      const embedded = joint?.exactRepairSolver
      if (
        joint &&
        embedded &&
        !(embedded instanceof GlobalDrcBranchPortfolioSolver)
      ) {
        if (joint.iterations !== 0 || embedded.iterations !== 0)
          throw new Error(
            "Repair dependency must be injected before its first step",
          )
        // The published Pipeline 9 bundle embeds repair03. Inject this checkout
        // at its existing solver boundary; preserve every input and the real
        // indexed/reference DRC evaluators. No copper geometry is edited here.
        const local = new GlobalDrcBranchPortfolioSolver(embedded.params)
        Object.assign(joint, {
          exactRepairSolver: local,
          activeSubSolver: local,
          MAX_ITERATIONS: local.MAX_ITERATIONS + 1,
        })
        this.repairs.push(local)
      }
      this.pipeline.step()
    }
    if (this.pipeline.failed)
      throw new Error(this.pipeline.error ?? "Pipeline 9 failed")
    return this.pipeline.getOutputSimplifiedPcbTraces()
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return this.pipeline.getOutputSimpleRouteJson() as SimpleRouteJson
  }
}
