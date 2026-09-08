import type { AutorouterConfig } from "@tscircuit/props"
import type { ReactElement } from "react"
import { MF_MSMF150_2 } from "./MF_MSMF150_2"
import { TYPE_C_31_M_12 } from "./TYPE_C_31_M_12"

export const UsbPowerCircuit = ({
  autorouter,
}: {
  autorouter: AutorouterConfig
}): ReactElement => (
  <board
    width={34}
    height={26}
    layers={4}
    autorouter={autorouter}
    autorouterVersion="beta_pipeline9"
    allowBlindAndBuriedVias={false}
    minTraceWidth={0.1}
    defaultTraceWidth={0.15}
    minTraceToPadEdgeClearance={0.1}
    minViaEdgeToPadEdgeClearance={0.1}
    minViaHoleDiameter={0.3}
    minViaPadDiameter={0.55}
  >
    <TYPE_C_31_M_12
      name="J_USB_C"
      pcbX={-7}
      pcbY={-7.5}
      noConnect={["A6", "A7", "B6", "B7", "A8", "B8"]}
    />
    <MF_MSMF150_2 name="F_VBUS" pcbX={1.5} pcbY={-5.3} />
    <resistor
      name="R_USB_CC1"
      resistance="5.1k"
      footprint="0402"
      manufacturerPartNumber="0402WGF5101TCE"
      pcbX={-9.5}
      pcbY={-3}
      pcbRotation={90}
    />
    <resistor
      name="R_USB_CC2"
      resistance="5.1k"
      footprint="0402"
      manufacturerPartNumber="0402WGF5101TCE"
      pcbX={-4.5}
      pcbY={-3}
      pcbRotation={90}
    />
    <capacitor
      name="C_VBUS"
      capacitance="22uF"
      footprint="0603"
      manufacturerPartNumber="CL10A226MQ8NRNC"
      pcbX={9}
      pcbY={-5}
      pcbRotation={90}
    />
    <trace
      name="USB_VBUS_A_IN"
      from="J_USB_C.A4B9"
      to="F_VBUS.pin1"
      width={0.8}
      routingPhaseIndex={0}
    />
    <trace
      name="USB_VBUS_B_IN"
      from="J_USB_C.B4A9"
      to="F_VBUS.pin1"
      width={0.8}
      routingPhaseIndex={1}
    />
    <trace
      name="USB_CC1"
      from="J_USB_C.A5"
      to="R_USB_CC1.pin1"
      routingPhaseIndex={2}
    />
    <trace
      name="USB_CC2"
      from="J_USB_C.B5"
      to="R_USB_CC2.pin1"
      routingPhaseIndex={3}
    />
    <trace
      name="VBUS_FUSED"
      from="F_VBUS.pin2"
      to="C_VBUS.pin1"
      width={0.8}
      routingPhaseIndex={4}
    />
    <trace
      name="GND"
      path={[
        "J_USB_C.A1B12",
        "J_USB_C.B1A12",
        "J_USB_C.EH1",
        "J_USB_C.EH2",
        "J_USB_C.EH3",
        "J_USB_C.EH4",
        "R_USB_CC1.pin2",
        "R_USB_CC2.pin2",
        "C_VBUS.pin2",
      ]}
      routingPhaseIndex={5}
    />
  </board>
)
