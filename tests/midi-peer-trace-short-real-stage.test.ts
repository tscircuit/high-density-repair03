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
  // Exact constructor input before Global repair in the real MIDI keyboard
  // usb-dp-phase-detour fixture from tscircuit-autorouter d4e4962b.
  // The full source fixture SHA is 78966edc3a39e56ee1253022012c5da28b8dae0a7921d5d3ffde4382c9ebe5af.
  // This stage retains all 148 new routes, 21 preloads and 1108 processed pads.
  const raw = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL("./fixtures/midi-global-stage.json.gz", import.meta.url),
      ),
    ),
  )
  expect(createHash("sha256").update(Uint8Array.from(raw)).digest("hex")).toBe(
    "d8b65c8767d0dd4ad5b03635ee10d0d118cd69db0c23a111cff3d9bca6bc3e38",
  )
  const input = JSON.parse(raw.toString("utf8")) as MidiStageInput
  const original = structuredClone(input)
  expect(input.hdRoutes).toHaveLength(148)
  expect(input.srj.obstacles).toHaveLength(1108)
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

test.failing("real-stage: MIDI repair preserves the original physical peer-contact set", (): void => {
  expect(newPairs).toEqual([])
})
