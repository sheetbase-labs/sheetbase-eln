/**
 * MOB-02.4 — the workspace model record page on a phone.
 *
 * The page is already one column of fields, so the phone treatment is the
 * action placement `canvas/RecordPhone.dc.html` draws: the header keeps the
 * desktop actions and, below the phone breakpoint, they reappear at the end of
 * the column as full-width 44px targets (`size="lg"` → `h-11`). jsdom cannot
 * evaluate the media queries, so the split is proved by the responsive classes,
 * as `app-shell.test.tsx` does for the phone shell.
 */
import { cleanup, render as plainRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { fetchModelFields } from '#/lib/model-fields'
import { notebookDataClient } from '#/lib/notebook-data'
import { dropSharedReads } from '#/lib/data-client'
import { fetchModelTypes } from '#/lib/model-subtypes'
import type { TimelineEventWire } from '#/lib/sign-002'
import type { RecordModelRecord as ModelRecord } from './models-data'
import { recordModelDetailQueryKeys, recordModelQueryKeys } from './models-data'
import { modelTypeQueryKeys } from './model-subtype-data'
import { RecordModelRecord } from './record-model-record'

const queryClients = new Set<QueryClient>()

// The real singleton DataClient captures fetch during module initialisation.
const transport = vi.hoisted(() => {
  const fetch = vi.fn<typeof globalThis.fetch>()

  vi.stubGlobal('fetch', fetch)

  return fetch
})

async function render(
  ui: ReactElement,
  options: {
    prefetch?: boolean
    waitForLoaded?: boolean
    records?: () => Promise<Response>
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  queryClients.add(client)
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  transport.mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/record_models':
        return Promise.resolve(
          Response.json(
            url.searchParams.has('key')
              ? [{ name: 'Cell bank', current_version: 4 }]
              : [],
          ),
        )
      case '/api/db/records':
        return options.records?.() ?? Promise.resolve(Response.json([record]))
      case '/api/db/record_model_versions':
        return Promise.resolve(
          Response.json([
            {
              definition: {
                fields: fields.map((field) => ({
                  ...field,
                  field_name: field.fieldName,
                  logical_type: field.logicalType,
                  display_order: field.displayOrder,
                  default_value: field.defaultValue,
                })),
              },
            },
          ]),
        )
      case '/api/db/rpc/record_timeline':
        return Promise.resolve(Response.json(timeline))
      default:
        return Promise.resolve(Response.json([]))
    }
  })

  // Loaded-page tests keep their original fixture scope; cold queries are
  // exercised separately below through the same real transport and providers.
  if (options.prefetch !== false)
    await Promise.all([
      client.fetchQuery({
        queryKey: recordModelQueryKeys.model('cell_bank'),
        queryFn: async () =>
          (
            await notebookDataClient.list('record_models', '?key=eq.cell_bank')
          )[0],
      }),
      client.fetchQuery({
        queryKey: recordModelDetailQueryKeys.record('rec-1'),
        queryFn: async () =>
          (await notebookDataClient.list('records', '?id=eq.rec-1'))[0],
      }),
      client.fetchQuery({
        queryKey: modelTypeQueryKeys.all,
        queryFn: () => fetchModelTypes(notebookDataClient),
      }),
      client.fetchQuery({
        queryKey: [...recordModelQueryKeys.fields('cell_bank'), 'version-1'],
        queryFn: () =>
          fetchModelFields(notebookDataClient, 'cell_bank', true, 'version-1'),
      }),
      client.fetchQuery({
        queryKey: recordModelDetailQueryKeys.timeline('rec-1'),
        queryFn: () =>
          notebookDataClient.rpc('record_timeline', { p_record_id: 'rec-1' }),
      }),
    ])

  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const result = plainRender(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  if (options.waitForLoaded !== false)
    await screen.findByText(/integrations appear in the history/)

  return { ...result, client }
}

const record: ModelRecord = {
  id: 'rec-1',
  identifier: 'CB-0012',
  title: 'HEK293 WCB lot 3',
  kind: 'cell_bank',
  status: 'draft',
  custom_fields: null,
  properties: null,
  tags: [],
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z',
  archived_at: null,
  model_version_id: 'version-1',
  model_version: { version: 1 },
}

let timeline: TimelineEventWire[] = []
let fields: ModelFieldDefinition[] = []

afterEach(() => {
  cleanup()
  queryClients.forEach((client) => client.clear())
  queryClients.clear()
  timeline = []
  fields = []
  record.custom_fields = null
  vi.unstubAllGlobals()
})

/** The class tokens on the element that wraps the action, not a substring. */
function wrapperClasses(button: HTMLElement): string[] {
  return (button.parentElement?.className ?? '').split(/\s+/)
}

/** The integrations note's text, which must follow the record's history. */
function integrationsNote(): string {
  return screen
    .getByText(/integrations appear in the history/)
    .textContent.trim()
}

describe('RecordModelRecord — phone actions (MOB-02.4)', () => {
  it('renders cold queries through an unavailable record and a subsequent loaded record', async () => {
    let resolveResponse: ((response: Response) => void) | undefined

    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })

    let available = false

    const mounted = await render(
      <RecordModelRecord modelKey="cell_bank" recordId="rec-1" />,
      {
        prefetch: false,
        waitForLoaded: false,
        records: () =>
          available ? Promise.resolve(Response.json([record])) : response,
      },
    )

    expect(screen.queryByText('HEK293 WCB lot 3')).toBeNull()

    if (!resolveResponse) throw new Error('Response resolver not initialized')
    resolveResponse(Response.json([]))
    expect(await screen.findByText('Record not found')).toBeTruthy()
    available = true
    dropSharedReads()
    await mounted.client.invalidateQueries({
      queryKey: recordModelDetailQueryKeys.record('rec-1'),
    })
    expect(
      (await screen.findAllByText('HEK293 WCB lot 3')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Record not found')).toBeNull()
    expect(screen.getAllByText('CB-0012').length).toBeGreaterThan(0)
  })

  it('moves the record actions to the end of the phone column', async () => {
    await render(<RecordModelRecord modelKey="cell_bank" recordId="rec-1" />)

    // The record's essentials read in the single column either way.
    expect(screen.getAllByText('HEK293 WCB lot 3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CB-0012').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cell bank').length).toBeGreaterThan(0)
    expect(screen.queryByText(/model v4/)).toBeNull()

    for (const name of ['New Cell bank', 'All records']) {
      const buttons = screen.getAllByRole('button', { name })
      expect(buttons).toHaveLength(2)
      const [desktop, phone] = buttons
      expect(wrapperClasses(desktop)).toContain('max-md:hidden')
      expect(wrapperClasses(phone)).toContain('md:hidden')
      // 44px full-width touch target, as the phone canvas draws them.
      expect(phone.className).toContain('h-11')
    }
  })

  it('reads the record status the same way in the header and the details', async () => {
    await render(<RecordModelRecord modelKey="cell_bank" recordId="rec-1" />)

    // The stored code is `draft`; both surfaces name it the way the rest of
    // the app does, and the raw code is never shown.
    expect(screen.getAllByText('Draft')).toHaveLength(2)
    expect(screen.queryByText('draft')).toBeNull()
  })

  it('shows date fields in the same format as the record metadata', async () => {
    record.custom_fields = { frozen_on: '2026-05-02' }
    fields = [
      {
        id: 'f1',
        fieldName: 'frozen_on',
        label: 'Frozen on',
        logicalType: 'date',
        modelKey: 'cell_bank',
        description: null,
        displayOrder: 0,
        nullable: true,
        defaultValue: null,
        unit: null,
        validation: {},
        lifecycle: 'active',
        options: [],
      },
    ]
    await render(<RecordModelRecord modelKey="cell_bank" recordId="rec-1" />)

    // Created (11 Jul 2026) and the date field both read as short dates; the
    // raw ISO string never surfaces.
    expect(screen.getByText('14 Jul 2026')).toBeTruthy()
    expect(screen.getByText('2 May 2026')).toBeTruthy()
    expect(screen.queryByText('2026-05-02')).toBeNull()
  })
})

describe('RecordModelRecord — integrations note', () => {
  it('follows the record history instead of asserting nothing has written', async () => {
    const empty = await render(
      <RecordModelRecord modelKey="cell_bank" recordId="rec-1" />,
    )

    const noteWithNoHistory = integrationsNote()
    empty.unmount()

    timeline = [
      {
        type: 'change_event',
        id: 'event-1',
        seq: 1,
        ts: '2026-09-25T00:00:00.000Z',
        title: 'record update',
        actorUserId: null,
      },
    ]
    await render(<RecordModelRecord modelKey="cell_bank" recordId="rec-1" />)

    expect(integrationsNote()).toBeTruthy()
    expect(integrationsNote()).not.toBe(noteWithNoHistory)
  })
})
