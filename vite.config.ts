import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    // The Amp orb exposes the dev server through portal hostnames
    // (*.onamp.dev and the e2b.app sandbox host). Allow them so the
    // portal URL can reach Vite without a "Blocked request" error.
    allowedHosts: ['.onamp.dev', '.e2b.app', '.sheetbase.co.uk'],
  },
})

export default config
