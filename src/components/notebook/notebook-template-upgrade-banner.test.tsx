/**
 * EXP-04.1 — the notebook's template-version banner.
 *
 * Proves the banner states the pinned version and the newer published version
 * and links to the per-notebook update view; that it disappears when there is
 * nothing newer to take; and that it never applies anything by itself.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookTemplateUpgradeBanner } from './notebook-template-upgrade-banner'
import type { DataClient } from '#/lib/data-client'
import * as notebookTemplateData from '#/lib/notebook-template-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to?: string
    params?: Record<string, string>
    search?: Record<string, string>
    children?: ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, encodeURIComponent(value))
    }
    const query = new URLSearchParams(search).toString()
    return (
      <a href={query ? `${href}?${query}` : href} {...rest}>
        {children}
      </a>
    )
  },
}))

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

/** Read-only stub: the banner must not write through any of these. */
function stubClient(versions: TemplateVersionWire[]) {
  const list = vi.fn((table: string, query: string) => {
    if (table === 'notebook_template_versions') {
      if (query.startsWith('?id=eq.')) {
        return Promise.resolve(versions.filter((v) => query.includes(v.id)))
      }
      return Promise.resolve(versions)
    }
    if (table === 'notebook_templates') return Promise.resolve([templateWire])
    return Promise.resolve([])
  })
  const client = {
    list,
    count: vi.fn(() => Promise.resolve(0)),
    rpc: vi.fn(() => Promise.resolve({})),
    insert: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve([])),
    remove: vi.fn(() => Promise.resolve([])),
  } as unknown as DataClient
  return { client, list }
}

function renderBanner(
  pinnedVersionId: string | null,
  versions: TemplateVersionWire[],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const { client, list } = stubClient(versions)
  const applied = vi.spyOn(notebookTemplateData, 'applyNotebookTemplateUpgrade')
  const result = render(
    <QueryClientProvider client={queryClient}>
      <NotebookTemplateUpgradeBanner
        recordId={RECORD}
        pinnedVersionId={pinnedVersionId}
        client={client}
      />
    </QueryClientProvider>,
  )
  return { ...result, client, list, applied }
}

describe('NotebookTemplateUpgradeBanner (EXP-04.1)', () => {
  it('names the pinned and newer published versions and links to the update view', async () => {
    const { applied, client, list } = renderBanner(V3, [
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
    expect(applied).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.insert).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith(
      'notebook_template_versions',
      expect.stringContaining('template_id=eq.'),
    )
  })

  it('renders nothing when the pin is already the newest published version', async () => {
    const { container, applied, client } = renderBanner(V4, [
      versionWire(V3, 3, 'published'),
      versionWire(V4, 4, 'published'),
    ])

    await vi.waitFor(() =>
      expect(client.list).toHaveBeenCalledWith(
        'notebook_template_versions',
        expect.stringContaining('template_id=eq.'),
      ),
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.firstChild).toBeNull()
    expect(applied).not.toHaveBeenCalled()
  })

  it('renders nothing and reads nothing when the notebook is not pinned to a version', () => {
    const { container, client } = renderBanner(null, [])

    expect(container.firstChild).toBeNull()
    expect(client.list).not.toHaveBeenCalled()
  })
})
