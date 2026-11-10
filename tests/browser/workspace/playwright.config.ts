import { fileURLToPath } from 'node:url'
import { defineConfig } from 'playwright/test'
import sharedConfig from '../../../playwright.config'

const servers = Array.isArray(sharedConfig.webServer)
  ? sharedConfig.webServer
  : [sharedConfig.webServer]

const browserServer = servers.find(
  (server) => server?.url === 'http://127.0.0.1:3100',
)

if (!browserServer) throw new Error('Missing shared browser Vite server')

export default defineConfig({
  ...sharedConfig,
  projects: [
    { name: 'workspace-components', testDir: '.', testMatch: '*.test.ts' },
  ],
  webServer: {
    ...browserServer,
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    url: 'http://127.0.0.1:3100/@vite/client',
  },
})
