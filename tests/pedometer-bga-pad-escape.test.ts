import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  createPedometerPadEscapeRepro,
  getPedometerPadEscapeSnapshotSvg,
} from "../fixture-support/pedometerPadEscapeRepro"
import capture from "./fixtures/pedometer-bga-pad-escape.json"

test("repairs and snapshots the pedometer BGA crossing captured before Pipeline9 joint repair", () => {
  const repro = createPedometerPadEscapeRepro()
  const { routes, initialErrors, result } = repro
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]!.message).toContain("pcb_smtpad_34")
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
  expect(result.routes[0]!.vias).toEqual(routes[0]!.vias)
  expect(routes).toEqual(capture.routes)

  const snapshotSvg = getPedometerPadEscapeSnapshotSvg(repro)
  const snapshotPath = new URL(
    "./__snapshots__/pedometer-bga-pad-escape.snap.svg",
    import.meta.url,
  ).pathname
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, snapshotSvg)
  }
  expect(snapshotSvg).toBe(readFileSync(snapshotPath, "utf8"))
})
