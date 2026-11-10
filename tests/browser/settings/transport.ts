import { expect } from 'playwright/test'
import type { Page } from 'playwright/test'
import { z } from 'zod'
import type {
  BackupsOverview,
  RunBackupNowResult,
} from '../../../src/lib/workspace-backups'
import type {
  DiagnosticsResult,
  RunHealthResult,
  ConnectorDiagnosticsResult,
  UsageResult,
  StorageOverviewResult,
} from '../../../src/lib/admin-platform'
import type {
  PersonalTokenWire,
  CreatedPersonalTokenWire,
} from '../../../src/lib/personal-api-tokens'
import type {
  CredentialWire,
  CreatedCredentialWire,
} from '../../../src/lib/api-credential-admin'
import type { MySession } from '../../../src/components/settings/settings-sessions-data'
import type { getTwoFactorStatusFn } from '../../../src/components/settings/settings-two-factor-data'
import type { updateProfileNameFn } from '../../../src/components/settings/settings-profile-data'
import type { WorkspaceAdminContact } from '../../../src/lib/workspace-admins'
import type { HelpData } from '../../../src/lib/help'
import type { EmailStatus } from '../../../src/lib/email-status'
import { createRequire } from 'node:module'

type ServerResult =
  | BackupsOverview
  | RunBackupNowResult
  | DiagnosticsResult
  | RunHealthResult
  | ConnectorDiagnosticsResult
  | UsageResult
  | StorageOverviewResult
  | PersonalTokenWire[]
  | CreatedPersonalTokenWire
  | CredentialWire[]
  | CreatedCredentialWire
  | MySession[]
  | WorkspaceAdminContact[]
  | HelpData
  | EmailStatus
  | { signInAvailable: boolean }
  | Awaited<ReturnType<typeof getTwoFactorStatusFn>>
  | Awaited<ReturnType<typeof updateProfileNameFn>>
  | null

export interface ServerFixture {
  file: string
  name: string
  method?: 'GET' | 'POST'
  result: ServerResult | Error
}

const idSchema = z.strictObject({ file: z.string(), export: z.string() })

// Decode with Start's own installed serializer, rather than treating its
// reference graph as ordinary request JSON or adding another dependency.
const startRequire = createRequire(import.meta.resolve('@tanstack/react-start'))

const clientRequire = createRequire(
  startRequire.resolve('@tanstack/start-client-core/package.json'),
)

const { fromJSON } = z
  .object({ fromJSON: z.function({ input: [z.json()], output: z.json() }) })
  .parse(clientRequire('seroval'))

export function serverData(body: string | null) {
  if (!body) throw new Error('Server function body required')

  return z
    .object({ data: z.json() })
    .parse(fromJSON(z.json().parse(JSON.parse(body)))).data
}

/** Only declared compiled server functions receive responses; everything else fails. */
export async function serverFixtures(page: Page, fixtures: ServerFixture[]) {
  const calls: Array<{ file: string; name: string; body: string | null }> = []
  const unexpected: string[] = []
  await page.route('**/_serverFn/**', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)

    if (!id) throw new Error('Missing server function id')

    const decoded = idSchema.parse(
      JSON.parse(Buffer.from(id, 'base64url').toString('utf8')),
    )

    const fixture = fixtures.find(
      (entry) =>
        decoded.file === `/src/${entry.file}?tss-serverfn-split` &&
        decoded.export === `${entry.name}_createServerFn_handler`,
    )

    if (!fixture || route.request().method() !== (fixture.method ?? 'POST')) {
      unexpected.push(
        `${route.request().method()} ${decoded.file} ${decoded.export}`,
      )
      await route.abort('blockedbyclient')

      return
    }

    calls.push({
      file: fixture.file,
      name: fixture.name,
      body: route.request().postData(),
    })

    if (fixture.result instanceof Error) {
      await route.fulfill({
        status: 403,
        contentType: 'text/plain',
        body: fixture.result.message,
      })
    } else {
      await route.fulfill({ json: { result: fixture.result } })
    }
  })

  return { calls, assertExpected: () => expect(unexpected).toEqual([]) }
}

export async function openSettings(page: Page, view: string, options = '') {
  // Concurrent checkout edits must not hot-reload a form during its assertions.
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:3100\/\?token=/, (socket) =>
    socket.send(JSON.stringify({ type: 'connected' })),
  )
  await page.route('**/settings-fixture?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><div id="root"></div>
      <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
      <script type="module" src="/@vite/client"></script>
      <script type="module" src="/tests/browser/settings/route-fixture.tsx"></script>
      </body></html>`,
    }),
  )
  await page.goto(`/settings-fixture?view=${view}${options}`)
}
