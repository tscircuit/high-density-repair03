import { InteractiveGraphics } from "graphics-debug/react"
import { useMemo } from "react"
import {
  createPedometerPadEscapeRepro,
  getPedometerPadEscapeGraphics,
} from "../fixture-support/pedometerPadEscapeRepro"

export default function PedometerBgaPadEscapeFixture() {
  const repro = useMemo(createPedometerPadEscapeRepro, [])
  return (
    <div
      style={{
        fontFamily: "sans-serif",
        padding: 24,
        background: "white",
        color: "#0f172a",
      }}
    >
      <h2>Pedometer v1.0.6 — BGA pad escape</h2>
      <p>
        The 0.10 mm trace crosses pad 34 before repair. Moving its interior
        bends into the adjacent channel clears the violation; the via and
        terminal stay fixed.
      </p>
      <p>
        Blue: trace copper · Gray: pads · Red: offending pad 34 · Pale gray:
        0.05 mm clearance envelope · Green: terminal pad. Pan or zoom each view
        to inspect the geometry.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {(["before", "after"] as const).map((phase) => (
          <div key={phase}>
            <h3>
              {phase === "before"
                ? "Before: 1 DRC error"
                : "After: 0 DRC errors"}
            </h3>
            <InteractiveGraphics
              graphics={getPedometerPadEscapeGraphics(repro, phase)}
              height={650}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
