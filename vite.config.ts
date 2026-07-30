import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    {
      name: "gzip-json",
      enforce: "pre",
      load(id) {
        const filePath = id.split("?", 1)[0]
        if (!filePath?.endsWith(".json.gz")) return null
        const json = gunzipSync(readFileSync(filePath)).toString("utf8")
        return { code: `export default ${json}`, map: null }
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      lib: resolve(__dirname, "lib"),
      tests: resolve(__dirname, "tests"),
    },
  },
})
