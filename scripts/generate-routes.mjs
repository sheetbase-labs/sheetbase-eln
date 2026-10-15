/**
 * Generate the committed route tree, then restore the SSR registration block.
 *
 * `tsr generate` writes `src/routeTree.gen.ts` without the
 * `declare module '@tanstack/react-start'` block: that block is added by the
 * TanStack Start vite plugin, not by the standalone generator. Running the
 * generator on its own therefore deletes it from the committed file — which is
 * what `pnpm generate-routes` used to do, silently breaking the route tree for
 * the next person.
 *
 * This wrapper runs the generator and re-appends the block when it is missing,
 * so `pnpm generate-routes` is safe to run and its output is what we commit.
 * See docs/development/migrations.md's neighbourhood for migrations; this file
 * is the route-tree equivalent.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ROUTE_TREE = 'src/routeTree.gen.ts'
const MARKER = "declare module '@tanstack/react-start'"
const BLOCK = `
import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
`

const generator = 'node_modules/.bin/tsr'
console.log(`$ ${generator} generate`)
execFileSync(generator, ['generate'], { stdio: 'inherit' })

const generated = readFileSync(ROUTE_TREE, 'utf8')
if (generated.includes(MARKER)) {
  console.log('route tree already carries the SSR registration block')
} else {
  const trimmed = generated.replace(/\s*$/, '')
  writeFileSync(ROUTE_TREE, `${trimmed}\n${BLOCK}`)
  console.log('restored the SSR registration block stripped by tsr generate')
}
