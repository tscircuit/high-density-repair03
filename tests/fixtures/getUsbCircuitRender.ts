import type { CircuitJson } from "circuit-json"
import type { HighDensityRoute, SimpleRouteJson } from "../../lib"

export type UsbCircuitRender = {
  circuitJson: CircuitJson
  svg: string
  phases: Array<{
    solved: boolean
    repairs: Array<{
      stats: Record<string, number | boolean>
      input: HighDensityRoute[]
      output: HighDensityRoute[]
      srj: SimpleRouteJson
      netMap: Record<string, string[]>
    }>
  }>
}

let renderedCircuit: Promise<UsbCircuitRender> | undefined

const renderUsbCircuit = async (): Promise<UsbCircuitRender> => {
  const render = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/usb-terminal-clearance/renderCircuit.tsx`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(render.stdout).text(),
    new Response(render.stderr).text(),
    render.exited,
  ])
  if (exitCode !== 0) throw new Error(`Native circuit render failed: ${stderr}`)
  return JSON.parse(stdout) as UsbCircuitRender
}

export const getUsbCircuitRender = (): Promise<UsbCircuitRender> => {
  renderedCircuit ??= renderUsbCircuit()
  return renderedCircuit
}
