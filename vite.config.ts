import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Vite already forwards browser logs. Replaying them through TanStack's
    // server-to-browser pipe creates a feedback loop and exhausts Node's heap.
    devtools({ consolePiping: { enabled: false } }),
    tailwindcss(),
    tanstackStart(),
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
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into separate cacheable chunks.
        // These are loaded lazily by the routes that need them, but
        // without manualChunks the bundler may merge them into the
        // main entry when a non-code-split route transitively imports
        // them. Explicit chunks keep each vendor lib in its own file
        // so it can be cached independently and loaded on demand.
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            if (id.includes('@tiptap/') || id.includes('prosemirror')) {
              return 'tiptap'
            }
            if (
              id.includes('@xyflow/') ||
              id.includes('@dagrejs/') ||
              id.includes('dagre')
            ) {
              return 'reactflow'
            }
          }
        },
      },
    },
  },
})

export default config
