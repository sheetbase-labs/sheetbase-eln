import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// `tsr generate` runs the bare @tanstack/router-generator, which cannot emit
// the `declare module '@tanstack/react-start'` footer the TanStack Start Vite
// plugin appends on every dev/build run (it is assembled inside
// @tanstack/start-plugin-core and is not exported). Passing it via
// tsr.config.json's routeTreeFileFooter is not an option either — the Start
// plugin treats that value as a user footer and appends it *after* its own
// block, duplicating it. Without the footer the committed file and the dev
// server's output disagree, so `pnpm dev` dirties the working tree on every
// start. Regenerate the tree with `tsr generate`, then restore the Start
// footer so both outputs are identical.
const ROUTE_TREE_PATH = 'src/routeTree.gen.ts'

// Matches the footer built by buildRouteTreeFileFooter in
// @tanstack/start-plugin-core (routerFilePath = src/router.tsx,
// startFilePath = src/start.ts). If a future plugin version changes this
// block, update it to match the dev server's output.
const START_FOOTER = `import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}`

execFileSync('tsr', ['generate'], { stdio: 'inherit' })

const content = readFileSync(ROUTE_TREE_PATH, 'utf8')
if (!content.includes("declare module '@tanstack/react-start'")) {
  writeFileSync(ROUTE_TREE_PATH, `${content.trimEnd()}\n\n${START_FOOTER}\n`)
}
