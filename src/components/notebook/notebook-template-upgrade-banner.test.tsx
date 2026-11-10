/**
 * EXP-04.1 — the notebook's template-version banner.
 *
 * Proves the banner states the pinned version and the newer published version
 * and links to the per-notebook update view; that it disappears when there is
 * nothing newer to take; and that it never applies anything by itself.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookTemplateUpgradeBanner } from './notebook-template-upgrade-banner'
import { createDataClient } from '#/lib/data-client'

afterEach(() => cleanup())

const RECORD = '30000000-0000-4000-8000-000000000001'
const TEMPLATE = '40000000-0000-4000-8000-000000000001'
const V3 = '50000000-0000-4000-8000-000000000003'
const V4 = '50000000-0000-4000-8000-000000000004'
const V5 = '50000000-0000-4000-8000-000000000005'

const CONFIGURATION = { formatVersion: 1, parameters: [], placements: [] }

interface TemplateVersionWire {
  id: string
  template_id: string
  version: number
  lifecycle: string
  configuration_format_version: number
  configuration: typeof CONFIGURATION
  revision: number
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
  published_at: string | null
  published_by_user_id: string | null
  reason: string | null
  signed_by_user_id: string | null
  signed_meaning: string | null
  signed_at: string | null
  retired_at: string | null
  retired_by_user_id: string | null
}

function versionWire(
  id: string,
  version: number,
  lifecycle: string,
): TemplateVersionWire {
  return {
    id,
    template_id: TEMPLATE,
    version,
    lifecycle,
    configuration_format_version: 1,
    configuration: CONFIGURATION,
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: lifecycle === 'published' ? '2026-01-01T00:00:00.000Z' : null,
    published_by_user_id: null,
    reason: null,
    signed_by_user_id: null,
    signed_meaning: null,
    signed_at: null,
    retired_at: null,
    retired_by_user_id: null,
  }
}

const templateWire = {
  id: TEMPLATE,
  workspace_id: '60000000-0000-4000-8000-000000000001',
  key: 'clarification',
  name: 'Depth-filter clarification screen',
  description: null,
  display_id: null,
  lifecycle: 'active',
  revision: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by_user_id: null,
  updated_by_user_id: null,
}

/** The real client decodes controlled HTTP responses; any write is still observed. */
function bannerTransport(versions: TemplateVersionWire[]) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/notebook_template_versions') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')

      if (id) {
        return Response.json(versions.filter((v) => v.id === id))
      }

      return Response.json(versions)
    }

    if (url.pathname === '/api/db/notebook_templates')
      return Response.json([templateWire])

    throw new Error(`Unexpected request: ${url.pathname}`)
  })
}

function renderBanner(
  pinnedVersionId: string | null,
  versions: TemplateVersionWire[],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  const transport = bannerTransport(versions)
  const client = createDataClient(transport)

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <NotebookTemplateUpgradeBanner
          recordId={RECORD}
          pinnedVersionId={pinnedVersionId}
          client={client}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  )

  return { ...result, transport }
}

describe('NotebookTemplateUpgradeBanner (EXP-04.1)', () => {
  it('names the pinned and newer published versions and links to the update view', async () => {
    const { transport } = renderBanner(V3, [
      versionWire(V3, 3, 'published'),
      versionWire(V4, 4, 'published'),
      // A newer draft is not something to take.
      versionWire(V5, 5, 'draft'),
    ])

    // The action is an anchor (styled as a button), never a form submit.
    const link = await waitFor(() => {
      const found = screen.getByRole('button', { name: /review v\s*4/i })
      expect(found.tagName).toBe('A')

      return found
    })

    expect(link.getAttribute('href')).toBe(
      `/templates/${TEMPLATE}/update?record=${RECORD}`,
    )
    expect(screen.getByRole('status').textContent).toContain(
      'has a new version (v4). This notebook stays on v3 until you choose.',
    )

    // Informational only: nothing is previewed, applied or written.
    expect(transport).not.toHaveBeenCalledWith(
      expect.stringContaining('/rpc/apply_notebook_template_upgrade'),
      expect.anything(),
    )
    expect(transport).not.toHaveBeenCalledWith(
      expect.stringContaining('/rpc/'),
      expect.anything(),
    )
    expect(transport).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(transport).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(transport).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/db/notebook_template_versions?template_id=eq.',
      ),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('renders nothing when the pin is already the newest published version', async () => {
    const { container, transport } = renderBanner(V4, [
      versionWire(V3, 3, 'published'),
      versionWire(V4, 4, 'published'),
    ])

    await vi.waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/db/notebook_template_versions?template_id=eq.',
        ),
        expect.objectContaining({ method: 'GET' }),
      ),
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.firstChild).toBeNull()
    expect(transport).not.toHaveBeenCalledWith(
      expect.stringContaining('/rpc/apply_notebook_template_upgrade'),
      expect.anything(),
    )
  })

  it('renders nothing and reads nothing when the notebook is not pinned to a version', () => {
    const { container, transport } = renderBanner(null, [])

    expect(container.firstChild).toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })
})
