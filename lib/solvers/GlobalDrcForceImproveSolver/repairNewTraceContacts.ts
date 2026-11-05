import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { getPeerTraceRepairCandidates } from "./getPeerTraceRepairCandidates"
import {
  cloneRoutesForIndexes,
  hasNewTraceObstacleOverlaps,
  materializeRoutesForIndexes,
} from "./solverHelpers"
import type { TraceContactGuard } from "./TraceContactGuard"
import type { DrcSnapshot } from "./types"

type Candidate = { routes: HighDensityRoute[]; snapshot: DrcSnapshot }

function* getContactDisplacements({
  srj,
  routes,
  pair,
  connMap,
  viaHoleDiameter,
}: Parameters<typeof getPeerTraceRepairCandidates>[0]): Generator<
  HighDensityRoute[]
> {
  for (const proposal of getPeerTraceRepairCandidates({
    srj,
    routes,
    pair,
    connMap,
    viaHoleDiameter,
  })) {
    const indexes = routes.flatMap((route, index) =>
      route === proposal[index] ? [] : [index],
    )
    const preservesTopology = indexes.every((index) => {
      const original = routes[index]!,
        candidate = proposal[index]!
      return (
        original.route.length === candidate.route.length &&
        original.route.every(
          (point, pointIndex) =>
            point.z === candidate.route[pointIndex]!.z &&
            point.pcb_port_id === candidate.route[pointIndex]!.pcb_port_id &&
            point.toNextSegmentType ===
              candidate.route[pointIndex]!.toNextSegmentType,
        )
      )
    })
    if (preservesTopology) {
      // Coarse offsets can clear the annulus but overshoot into nearby pads.
      // Interpolate whole stacks together so every layer retains its exact anchor.
      for (const scale of [0.25, 0.5, 0.75]) {
        const candidate = cloneRoutesForIndexes(routes, indexes)
        for (const index of indexes) {
          for (
            let pointIndex = 0;
            pointIndex < routes[index]!.route.length;
            pointIndex++
          ) {
            const from = routes[index]!.route[pointIndex]!,
              to = proposal[index]!.route[pointIndex]!,
              point = candidate[index]!.route[pointIndex]!
            point.x = from.x + (to.x - from.x) * scale
            point.y = from.y + (to.y - from.y) * scale
          }
        }
        yield materializeRoutesForIndexes(candidate, indexes)
      }
    }
    yield proposal
  }
}

/** Preserve the repaired board's DRC quality while separating new copper contacts. */
export const repairNewTraceContacts = ({
  srj,
  routes,
  snapshot,
  inputSnapshot,
  guard,
  getSnapshot,
  hasNewObstacleOverlaps,
  connMap,
  viaHoleDiameter,
}: Candidate & {
  srj: SimpleRouteJson
  inputSnapshot: DrcSnapshot
  guard: TraceContactGuard
  getSnapshot: (routes: HighDensityRoute[]) => DrcSnapshot
  hasNewObstacleOverlaps?: (candidate: {
    routes: HighDensityRoute[]
    referenceRoutes: HighDensityRoute[]
    referenceSnapshot: DrcSnapshot
  }) => boolean
  connMap?: ConnectivityMap
  viaHoleDiameter?: number
}): Candidate | undefined => {
  let current = { routes, snapshot }
  let pairs = guard.getNewContactPairs(routes)
  if (pairs.length === 0) return undefined
  const viaCount = routes.reduce((count, route) => count + route.vias.length, 0)
  let geometryChecks = 0
  let drcChecks = 0
  for (let round = 0; round < 8; round++) {
    const pair = pairs[0]!
    const checkContacts = guard.prepareCandidateCheck(current.routes)
    let best: (Candidate & { pairs: typeof pairs }) | undefined
    for (const proposal of getContactDisplacements({
      srj,
      routes: current.routes,
      pair,
      connMap,
      viaHoleDiameter,
    })) {
      if (++geometryChecks > 256 || drcChecks >= 32) break
      if (
        proposal.reduce((count, route) => count + route.vias.length, 0) >
          viaCount ||
        guard.hasContactPair(proposal, pair)
      )
        continue
      const remaining = checkContacts(proposal)
      if (
        remaining.length >= pairs.length ||
        remaining.some(
          (contact) =>
            !pairs.some(
              (previous) =>
                previous[0] === contact[0] && previous[1] === contact[1],
            ),
        )
      )
        continue
      drcChecks++
      // Count the rejected proposal against the same search budget. A fixed-pad
      // short cannot pass the full snapshot acceptance check below.
      if (
        hasNewObstacleOverlaps?.({
          routes: proposal,
          referenceRoutes: current.routes,
          referenceSnapshot: current.snapshot,
        })
      )
        continue
      const candidateSnapshot = getSnapshot(proposal)
      if (
        candidateSnapshot.count > snapshot.count ||
        hasNewTraceObstacleOverlaps(candidateSnapshot, inputSnapshot)
      )
        continue
      if (
        !best ||
        remaining.length < best.pairs.length ||
        (remaining.length === best.pairs.length &&
          (candidateSnapshot.count < best.snapshot.count ||
            (candidateSnapshot.count === best.snapshot.count &&
              candidateSnapshot.issueScore < best.snapshot.issueScore)))
      )
        best = {
          routes: proposal,
          snapshot: candidateSnapshot,
          pairs: remaining,
        }
    }
    if (!best) return undefined
    current = best
    pairs = best.pairs
    if (pairs.length === 0) return current
  }
  return undefined
}
