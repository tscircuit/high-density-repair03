import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, SimpleRouteJson } from "../../../lib"

export const loadBoard = () => {
  const input: {
    srj: SimpleRouteJson
    hdRoutes: HighDensityRoute[]
    netMap: ConnectivityMap["netMap"]
  } = JSON.parse(
    gunzipSync(
      readFileSync(new URL("./full-board.json.gz", import.meta.url)),
    ).toString(),
  )
  return { ...input, connMap: new ConnectivityMap(input.netMap) }
}
