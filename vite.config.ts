import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The pinned clock, exposed to the browser bundle so client-rendered,
 * time-dependent surfaces (hold banners, relative dates) agree with the server.
 * Only development and test pin it; deployed builds get an empty string and the
 * client falls back to real time. See src/lib/clock.ts.
 */
const pinnedNow =
  process.env.SHEETBASE_ENV === 'development' ||
  process.env.SHEETBASE_ENV === 'test'
    ? (process.env.SHEETBASE_NOW ?? '')
    : ''

/**
 * src/lib/request-log.ts reads the current request through nitro/context, which
 * only exists on the server. The browser bundle still reaches it through shared
 * modules, so give the client an inert stand-in instead of Nitro's runtime.
 */
const clientRequestStub = {
  name: 'sheetbase:client-request-context-stub',
  enforce: 'pre' as const,
  resolveId(this: { environment?: { name: string } }, id: string) {
    if (id === 'nitro/context' && this.environment?.name === 'client') {
      return '\0nitro-context-client-stub'
    }
    return null
  },
  load(id: string) {
    return id === '\0nitro-context-client-stub'
      ? 'export const useRequest = () => { throw new Error("No request on the client") }'
      : null
  },
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  define: {
    __SHEETBASE_NOW__: JSON.stringify(pinnedNow),
  },
  plugins: [
    // Vite already forwards browser logs. Replaying them through TanStack's
    // server-to-browser pipe creates a feedback loop and exhausts Node's heap.
    devtools({ consolePiping: { enabled: false } }),
    tailwindcss(),
    clientRequestStub,
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
  server: {
    // The Amp orb exposes the dev server through portal hostnames
    // (*.onamp.dev and the e2b.app sandbox host). Allow them so the
    // portal URL can reach Vite without a "Blocked request" error.
    // *.trycloudflare.com is used for throwaway Cloud Agent quick tunnels.
    allowedHosts: [
      '.onamp.dev',
      '.e2b.app',
      '.sheetbase.co.uk',
      '.trycloudflare.com',
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        // Split heavy vendor libraries into separate cacheable chunks.
        // These are loaded lazily by the routes that need them, but
        // without explicit chunks the bundler may merge them into the
        // main entry when a non-code-split route transitively imports
        // them. Explicit chunks keep each vendor lib in its own file
        // so it can be cached independently and loaded on demand.
        codeSplitting: {
          groups: [
            {
              // React is shared by every chunk. Without its own chunk the
              // bundler parks it inside whichever chunk loads first
              // (it was `tiptap`), which drags the editor into the first load.
              name: 'react',
              test: /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(react|react-dom|scheduler|use-sync-external-store)\//,
              priority: 40,
            },
            {
              name: 'tiptap',
              test: /\/node_modules\/.*(@tiptap\/|prosemirror)/,
              priority: 30,
            },
            {
              name: 'reactflow',
              test: /\/node_modules\/.*(@xyflow\/|@dagrejs\/|dagre)/,
              priority: 30,
            },
            {
              // Left alone, every distinct set of screens that shares a
              // module gets its own file, and a cold notebook open fetched
              // more than 200 of them. Modules used by twelve or more
              // chunks are what nearly every screen needs, so they travel
              // together. Lower numbers fold in code that fewer screens
              // use and make the first load of Home heavier; higher
              // numbers bring the file count back up.
              name: 'common',
              minShareCount: 12,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})

export default config
