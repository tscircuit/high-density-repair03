import { RootCircuit } from "@tscircuit/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { LocalRepairAutorouter } from "./LocalRepairAutorouter"
import { UsbPowerCircuit } from "./UsbPowerCircuit"

const autorouters: LocalRepairAutorouter[] = []
const circuit = new RootCircuit()
circuit.schematicDisabled = true
circuit.add(
  <UsbPowerCircuit
    autorouter={{
      local: true,
      allowViaInPad: false,
      algorithmFn: async (srj) => {
        const autorouter = new LocalRepairAutorouter(srj)
        autorouters.push(autorouter)
        return autorouter
      },
    }}
  />,
)
await circuit.renderUntilSettled()
const circuitJson = circuit.getCircuitJson()
console.log(
  JSON.stringify({
    circuitJson,
    svg: convertCircuitJsonToPcbSvg(circuitJson),
    phases: autorouters.map((router) => ({
      solved: router.pipeline.solved,
      repairs: router.repairs.map((repair) => ({
        stats: repair.stats,
        input: repair.params.hdRoutes,
        output: repair.getOutput(),
        srj: repair.params.srj,
      })),
    })),
  }),
)
