import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { beforeAll, expect, test } from "bun:test"
import "bun-match-svg"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "../lib"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  getPeerTraceSnapshotSvg,
  getPhysicalPeerPairs,
  type MidiStageInput,
} from "./fixtures/peerTraceShort"

let newPairs: string[]

beforeAll(async (): Promise<void> => {
  // Nine original routed connections and seven original pads isolate the MIDI
  // publication problem; every retained copper coordinate and rule is unchanged.
  const raw = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL("./fixtures/midi-peer-focused.json.gz", import.meta.url),
      ),
    ),
  )
  expect(createHash("sha256").update(Uint8Array.from(raw)).digest("hex")).toBe(
    "d30b5b5d2e2ef5cae6d0b3661be616e704f926a420c8b9e05e6eca0d7fb2cf0f",
  )
  const input = JSON.parse(raw.toString("utf8")) as MidiStageInput
  const original = structuredClone(input)
  expect(input.hdRoutes).toHaveLength(9)
  expect(input.srj.obstacles).toHaveLength(7)
  expect(input.srj.traces).toHaveLength(21)
  expect(input.effort).toBe(1)
  expect(input.maxIterations).toBe(16)
  const connMap = Object.assign(new ConnectivityMap(input.netMap), {
    idToNetMap: input.idToNetMap,
  })
  const before = getPhysicalPeerPairs(input.hdRoutes, connMap)
  expect(before).not.toContain(
    JSON.stringify(["source_net_24", "source_net_46"]),
  )
  const solver = new GlobalDrcForceImproveSolver({ ...input, connMap })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  expect(output).toHaveLength(input.hdRoutes.length)
  expect(output.map((route) => route.connectionName)).toEqual(
    input.hdRoutes.map((route) => route.connectionName),
  )
  for (const route of output) {
    const source = input.hdRoutes.find(
      (candidate) => candidate.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(source.route[0])
    expect(route.route.at(-1)).toEqual(source.route.at(-1))
  }
  expect(input).toEqual(original)
  newPairs = getPhysicalPeerPairs(output, connMap).filter(
    (pair) => !before.includes(pair),
  )
  const measured = getDrcSnapshot(
    input.srj,
    output,
    undefined,
    connMap,
    new AutoroutingDrcEngine(input.srj, { connMap }),
  )
  // Snapshot and all input/terminal guards are outside the expected failure.
  await expect(
    getPeerTraceSnapshotSvg({
      srj: input.srj,
      routes: output,
      drcCount: measured.count,
      newPairCount: newPairs.length,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

test.failing("focused: MIDI repair preserves the original physical peer-contact set", (): void => {
  expect(newPairs).toEqual([])
})
