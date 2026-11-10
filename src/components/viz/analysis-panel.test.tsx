/**
 * SCI-02 analysis panel interaction tests. The panel composes dataset
 * selection, definition authoring, pure execution and saved-definition
 * persistence over canonical Datasets through the real DataClient transport.
 */
import userEvent from '@testing-library/user-event'
import { choose } from '../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { z } from 'zod'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AnalysisPanel, AnalysisResultTable } from './analysis-panel'
import { buildRegressionFitChart } from './analysis-charts'
import { runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisDefinition } from '#/lib/analysis-definition'
import type { ChartColumn } from '#/lib/chart-spec'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import { createDataClient } from '#/lib/data-client'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { Toaster, toast } from '#/components/ui/sonner'
import { notebookQueryKeys } from '#/lib/notebook-data'
import type { RecordWire, BlockWire } from '#/lib/notebook-data'

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory(),
})

function TestQueryProvider({
  client,
  children,
}: {
  client: QueryClient
  children: ReactNode
}) {
  return (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RouterContextProvider>
  )
}

const saveBodySchema = z.object({
  name: z.string(),
  definition: z.looseObject({
    datasets: z.array(
      z.looseObject({
        datasetId: z.string(),
        datasetVersionId: z.string().optional(),
      }),
    ),
  }),
  source_revisions: z.array(
    z.object({
      datasetId: z.string(),
      revision: z.number(),
      schemaVersionNumber: z.number(),
    }),
  ),
})

let definitions: AnalysisDefinitionWire[] = []

let rows = [
  { time: 0, recovery: 100, condition: '4C' },
  { time: 24, recovery: 90, condition: '4C' },
  { time: 0, recovery: 80, condition: '20C' },
  { time: 24, recovery: 70, condition: '20C' },
]

let changedSource = false
const writes: Array<{ id: string; body: z.infer<typeof saveBodySchema> }> = []
const deleted: string[] = []

const transport: typeof fetch = async (input, init) => {
  const request =
    input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(input, 'http://localhost'), init)

  const url = new URL(request.url)
  const resource = url.pathname.split('/').at(-1)

  if (resource === 'analysis_definitions') {
    if (request.method === 'GET') return Response.json(definitions)
    const id = url.searchParams.get('id')?.replace('eq.', '') ?? 'saved'

    if (request.method === 'DELETE') {
      deleted.push(id)
      definitions = definitions.filter((definition) => definition.id !== id)

      return Response.json([])
    }

    const body = saveBodySchema.parse(await request.json())
    writes.push({ id, body })

    const saved = {
      ...body,
      id,
      workspace_id: 'ws-1',
      owner_user_id: 'user-1',
      version: 1,
      created_at: '',
      updated_at: '',
    }

    definitions = [saved]

    return Response.json([saved])
  }

  if (resource === 'datasets')
    return Response.json([
      {
        id: url.searchParams.get('id')?.replace('eq.', ''),
        name:
          url.searchParams.get('id') === `eq.${DATASET.datasetId}`
            ? DATASET.name
            : 'Other dataset',
        workspace_id: DATASET.workspaceId,
        schema_version_id: DATASET.schemaVersionId,
        revision: changedSource ? 2 : 1,
      },
    ])

  if (resource === 'dataset_schema_versions')
    return Response.json([{ id: DATASET.schemaVersionId, version: 1 }])

  if (resource === 'dataset_schema_version_fields')
    return Response.json(
      DATASET.columns.map((column) => ({
        field_id: column.id,
        label: column.label,
        logical_type: column.logicalType,
        quantity: null,
      })),
    )

  if (resource === 'dataset_value_flags') return Response.json([])

  if (resource === 'dataset_versions')
    return Response.json([
      {
        id: url.searchParams.get('id')?.replace('eq.', ''),
        dataset_id: DATASET.datasetId,
        schema_version_id: DATASET.schemaVersionId,
        source_dataset_revision: 1,
      },
    ])

  if (
    resource === 'query_dataset_rows' ||
    resource === 'query_dataset_version_rows'
  )
    return Response.json({
      rows: rows.map((row, index) => ({
        rowId: `row-${index}`,
        revision: 1,
        values: {
          [FIELD_TIME]: row.time,
          [FIELD_RECOVERY]: row.recovery,
          [FIELD_CONDITION]: row.condition,
        },
      })),
      totalCount: rows.length,
      datasetRevision: 1,
    })
  throw new Error(
    `Unexpected analysis transport request: ${request.method} ${url.pathname}`,
  )
}

let dataClient = createDataClient(transport)

const FIELD_TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const FIELD_RECOVERY = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const FIELD_CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const DATASET: CanonicalDatasetSource = {
  datasetId: '11111111-1111-1111-8111-111111111111',
  name: 'Stability',
  workspaceId: 'ws-1',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 1,
  columns: [
    { id: FIELD_TIME, label: 'Time (h)', logicalType: 'decimal' },
    { id: FIELD_RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
    { id: FIELD_CONDITION, label: 'Condition', logicalType: 'category' },
  ],
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return ({ children }: { children: ReactNode }) => (
    <TestQueryProvider client={client}>{children}</TestQueryProvider>
  )
}

beforeEach(() => {
  definitions = []
  writes.length = 0
  deleted.length = 0
  changedSource = false
  rows = [
    { time: 0, recovery: 100, condition: '4C' },
    { time: 24, recovery: 90, condition: '4C' },
    { time: 0, recovery: 80, condition: '20C' },
    { time: 24, recovery: 70, condition: '20C' },
  ]
  // A fresh transport identity gives each test an isolated DataClient read cache.
  dataClient = createDataClient((...args) => transport(...args))
})

afterEach(() => {
  toast.dismiss()
  cleanup()
})

function renderPanel() {
  render(
    <AnalysisPanel
      dataClient={dataClient}
      datasets={[DATASET]}
      workspaceId="ws-1"
      userId="user-1"
    />,
    { wrapper: wrapper() },
  )
}

async function runDescriptive() {
  renderPanel()
  await screen.findByLabelText('Analysis dataset')
  await choose(userEvent.setup(), 'Analysis dataset', /Stability/)
  fireEvent.click(screen.getByRole('button', { name: /Descriptive \/ ANOVA/i }))
  await waitFor(() =>
    expect(screen.getByLabelText('Measured value column')).toBeTruthy(),
  )

  const runButton = screen.getByRole<HTMLButtonElement>('button', {
    name: /Run/i,
  })

  await waitFor(() => expect(runButton.disabled).toBe(false))
  fireEvent.click(runButton)
}

describe('AnalysisPanel', () => {
  it.each([false, true])(
    'invalidates the cited notebook after insertion, including freeze refusal=%s',
    async (refuseFreeze) => {
      const experiment: RecordWire = {
        id: 'experiment-1',
        workspace_id: 'ws-1',
        project_id: null,
        folder_id: null,
        kind: 'experiment',
        identifier: 'EXP-001',
        title: 'Evidence',
        status: 'draft',
        tags: [],
        structure_version: 4,
        metadata_version: 1,
        created_at: '',
        updated_at: '',
        archived_at: null,
        deleted_at: null,
        created_by_user_id: 'user-1',
        updated_by_user_id: null,
        properties: {},
        locked_at: null,
        locked_by_revision_id: null,
      }

      const block: BlockWire = {
        id: 'analysis-block',
        record_id: experiment.id,
        type: 'analysis',
        payload: { definitionId: 'def-1', title: 'Recovery summary' },
        payload_schema_version: 1,
        order: 1,
        version: 1,
        created_at: '',
        updated_at: '',
      }

      const calls: Array<{ name: string; body: unknown }> = []

      const citationClient = createDataClient(async (input, init) => {
        const request =
          input instanceof Request
            ? new Request(input, init)
            : new Request(new URL(input, 'http://localhost'), init)

        const resource = new URL(request.url).pathname.split('/').at(-1)

        if (resource === 'records') return Response.json([experiment])

        if (
          resource === 'insert_block' ||
          resource === 'freeze_analysis_block'
        ) {
          calls.push({ name: resource, body: await request.json() })

          if (resource === 'insert_block')
            return Response.json({ block, structure_version: 5 })

          if (refuseFreeze)
            return Response.json(
              { code: 'conflict', message: 'Freeze refused' },
              { status: 409 },
            )

          return Response.json({})
        }

        return transport(input, init)
      })

      definitions = [
        {
          id: 'def-1',
          name: 'Recovery summary',
          workspace_id: 'ws-1',
          owner_user_id: 'user-1',
          version: 1,
          source_revisions: [],
          created_at: '',
          updated_at: '',
          definition: {
            definitionVersion: 1,
            kind: 'descriptive',
            datasets: [{ datasetId: DATASET.datasetId }],
            value: { fieldId: FIELD_RECOVERY },
          },
        },
      ]

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })

      const affectedKeys = [
        notebookQueryKeys.record(experiment.id),
        notebookQueryKeys.blocks(experiment.id),
        notebookQueryKeys.activity(experiment.id),
      ]

      const unrelatedKey = notebookQueryKeys.blocks('other-experiment')

      for (const key of affectedKeys) client.setQueryData(key, [])
      client.setQueryData(unrelatedKey, [])
      render(
        <TestQueryProvider client={client}>
          <Toaster />
          <AnalysisPanel
            dataClient={citationClient}
            datasets={[DATASET]}
            workspaceId="ws-1"
            userId="user-1"
            initialDefinitionId="def-1"
            experimentId={experiment.id}
          />
        </TestQueryProvider>,
      )
      fireEvent.click(
        await screen.findByRole('button', { name: /Cite in a notebook/ }),
      )
      await screen.findByText('Citing into EXP-001')
      fireEvent.click(screen.getByRole('button', { name: 'Cite' }))
      await waitFor(() => {
        for (const key of affectedKeys)
          expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      })
      expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
      expect(calls).toEqual([
        {
          name: 'insert_block',
          body: {
            p_record_id: experiment.id,
            p_type: 'analysis',
            p_payload: block.payload,
            p_payload_schema_version: 1,
            p_after_block_id: null,
            p_before_block_id: null,
            p_expected_structure_version: 4,
          },
        },
        {
          name: 'freeze_analysis_block',
          body: { p_block_id: block.id, p_expected_version: 1 },
        },
      ])

      if (refuseFreeze) {
        expect(await screen.findByText('Freeze refused')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Cite' })).toBeTruthy()
      } else {
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Cite' })).toBeNull(),
        )
      }
    },
  )

  it.each(['invalid', 'chart'])(
    'refuses a %s saved definition without changing the draft, source or pin',
    async (kind) => {
      const snapshotId = '22222222-2222-4222-8222-222222222222'
      const ref = { datasetId: DATASET.datasetId }

      const definition =
        kind === 'invalid'
          ? {
              definitionVersion: 0,
              kind: 'descriptive',
              datasets: [ref],
              value: { fieldId: FIELD_RECOVERY },
            }
          : {
              definitionVersion: 1,
              kind: 'chart',
              datasets: [ref],
              chart: {
                datasets: [ref],
                fields: { y: { fieldId: FIELD_RECOVERY } },
              },
            }

      definitions = [
        {
          id: 'refused',
          name: 'Cannot edit here',
          definition,
          workspace_id: 'ws-1',
          owner_user_id: 'user-1',
          version: 1,
          source_revisions: [],
          created_at: '',
          updated_at: '',
        },
      ]

      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })

      client.setQueryData(
        ['analysis-definition-rows', DATASET.datasetId, snapshotId],
        {
          source: DATASET,
          rows: [],
          flags: [],
          truncated: false,
          totalCount: 0,
        },
      )
      client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])
      render(
        <TestQueryProvider client={client}>
          <Toaster />
          <AnalysisPanel
            dataClient={dataClient}
            datasets={[DATASET]}
            workspaceId="ws-1"
            userId="user-1"
            initialDatasetId={DATASET.datasetId}
            initialSnapshotId={snapshotId}
          />
        </TestQueryProvider>,
      )
      fireEvent.click(
        screen.getByRole('button', { name: /Descriptive \/ ANOVA/i }),
      )
      fireEvent.change(screen.getByLabelText('Analysis name'), {
        target: { value: 'Keep my draft' },
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Load' }))
      expect(
        await screen.findByText(
          kind === 'invalid'
            ? 'definitionVersion must be 1'
            : 'This analysis is a chart only, so there’s no statistic to compute.',
        ),
      ).toBeTruthy()
      expect(screen.getByDisplayValue('Keep my draft')).toBeTruthy()
      expect(screen.getByLabelText('Analysis dataset').textContent).toContain(
        'Stability',
      )
      expect(screen.getByText(/Reading (a )?snapshot/)).toBeTruthy()
      expect(
        screen.getByLabelText<HTMLSelectElement>('Measured value column').value,
      ).toBe(FIELD_TIME)
      expect(screen.getByRole('button', { name: /^Save$/ })).toBeTruthy()
      expect(writes).toEqual([])
    },
  )

  it('authors and saves against the examined snapshot schema and revision', async () => {
    const snapshotId = '22222222-2222-4222-8222-222222222222'

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])
    client.setQueryData(
      ['analysis-definition-rows', DATASET.datasetId, snapshotId],
      {
        source: {
          ...DATASET,
          revision: 2,
          schemaVersionNumber: 3,
          columns: [
            {
              id: FIELD_RECOVERY,
              label: 'Original recovery',
              logicalType: 'decimal',
            },
          ],
        },
        rows: [{ [FIELD_RECOVERY]: 7 }, { [FIELD_RECOVERY]: 13 }],
        flags: [],
        truncated: false,
        totalCount: 2,
      },
    )
    render(
      <TestQueryProvider client={client}>
        <AnalysisPanel
          dataClient={dataClient}
          datasets={[DATASET]}
          workspaceId="ws-1"
          userId="user-1"
          initialDatasetId={DATASET.datasetId}
          initialSnapshotId={snapshotId}
        />
      </TestQueryProvider>,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Descriptive \/ ANOVA/i }),
    )
    expect(
      screen.getByRole('option', { name: 'Original recovery' }),
    ).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLSelectElement>('Measured value column').value,
    ).toBe(FIELD_RECOVERY)
    fireEvent.change(screen.getByLabelText('Analysis name'), {
      target: { value: 'Original recovery' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(writes).toHaveLength(1))
    const input = writes[0].body
    expect(input.definition.datasets).toEqual([
      { datasetId: DATASET.datasetId, datasetVersionId: snapshotId },
    ])
    expect(input.source_revisions).toEqual([
      { datasetId: DATASET.datasetId, revision: 2, schemaVersionNumber: 3 },
    ])
  })

  it('runs a grouped descriptive analysis against live rows', async () => {
    await runDescriptive()
    // Groups appear in codepoint-sorted order with computed statistics.
    expect(screen.getByText('20C')).toBeTruthy()
    expect(screen.getByText('4C')).toBeTruthy()
    expect(screen.getByText('median')).toBeTruthy()
  })

  it('clears an optional grouping binding without changing the analysis kind', async () => {
    await runDescriptive()
    fireEvent.change(screen.getByLabelText('Group by column'), {
      target: { value: '' },
    })
    expect(
      screen.getByLabelText<HTMLSelectElement>('Group by column').value,
    ).toBe('')
    expect(screen.getByText('Descriptive statistics')).toBeTruthy()
    expect(screen.queryByText('One-way ANOVA')).toBeNull()
    expect(screen.getByText('median')).toBeTruthy()
  })

  it("selects the requested dataset once a deep link's sources arrive", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const tree = (datasets: CanonicalDatasetSource[]) => (
      <TestQueryProvider client={client}>
        <AnalysisPanel
          dataClient={dataClient}
          datasets={datasets}
          workspaceId="ws-1"
          userId="user-1"
          initialDatasetId={DATASET.datasetId}
        />
      </TestQueryProvider>
    )

    const { rerender } = render(tree([]))
    const select = await screen.findByLabelText('Analysis dataset')
    expect(select.textContent).toBe('Select a dataset')
    rerender(tree([DATASET]))
    await waitFor(() => expect(select.textContent).toContain('Stability'))
    // A later choice of "no dataset" is the person's and is kept.
    await choose(userEvent.setup(), 'Analysis dataset', 'Select a dataset')
    rerender(tree([DATASET]))
    expect(select.textContent).toBe('Select a dataset')
  })

  it('synchronises studio source changes without losing a loaded snapshot', async () => {
    const other = { ...DATASET, datasetId: 'other', name: 'Other dataset' }
    const snapshotId = '22222222-2222-4222-8222-222222222222'

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])
    definitions = [
      {
        id: 'pinned',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Pinned recovery',
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [
            { datasetId: DATASET.datasetId, datasetVersionId: snapshotId },
          ],
          value: { fieldId: FIELD_RECOVERY },
        },
        source_revisions: [],
        version: 1,
        created_at: '',
        updated_at: '',
      },
    ]

    function Studio() {
      const [source, setSource] = useState(other.datasetId)

      return (
        <TestQueryProvider client={client}>
          <label>
            Studio source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {[DATASET, other].map((dataset) => (
                <option key={dataset.datasetId} value={dataset.datasetId}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <AnalysisPanel
            dataClient={dataClient}
            datasets={[DATASET, other]}
            workspaceId="ws-1"
            userId="user-1"
            initialDatasetId={source}
            onDatasetChange={setSource}
          />
        </TestQueryProvider>
      )
    }

    render(<Studio />)
    const studio = screen.getByLabelText<HTMLSelectElement>('Studio source')
    const panel = screen.getByLabelText('Analysis dataset')
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }))
    await waitFor(() => expect(studio.value).toBe(DATASET.datasetId))
    expect(panel.textContent).toContain('Stability')
    expect(screen.getByText(/Reading (a )?snapshot/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()

    await choose(userEvent.setup(), 'Analysis dataset', /Other dataset/)
    expect(studio.value).toBe(other.datasetId)
    expect(screen.queryByText(/Reading (a )?snapshot/)).toBeNull()
    expect(screen.queryByLabelText('Measured value column')).toBeNull()

    fireEvent.change(studio, { target: { value: DATASET.datasetId } })
    await waitFor(() => expect(panel.textContent).toContain('Stability'))
    expect(screen.queryByText(/Reading snapshot/)).toBeNull()
  })

  it('opens a deep-linked definition after its query arrives, synchronising the parent only once', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const other = { ...DATASET, datasetId: 'other', name: 'Other dataset' }
    const snapshotId = '22222222-2222-4222-8222-222222222222'
    let releaseDefinitions: (() => void) | undefined

    const definitionsReady = new Promise<void>((resolve) => {
      releaseDefinitions = resolve
    })

    dataClient = createDataClient(async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname.endsWith('/analysis_definitions')) await definitionsReady

      return transport(input, init)
    })

    client.setQueryData(['dataset-version-summaries', DATASET.datasetId], [])

    function Studio() {
      const [source, setSource] = useState(other.datasetId)

      return (
        <TestQueryProvider client={client}>
          <label>
            Studio source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {[DATASET, other].map((dataset) => (
                <option key={dataset.datasetId} value={dataset.datasetId}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <AnalysisPanel
            dataClient={dataClient}
            datasets={[DATASET, other]}
            workspaceId="ws-1"
            userId="user-1"
            initialDatasetId={source}
            onDatasetChange={setSource}
            initialDefinitionId="delayed"
          />
        </TestQueryProvider>
      )
    }

    render(<Studio />)
    await screen.findByText('Loading saved analyses…')
    expect(
      screen.getByLabelText<HTMLSelectElement>('Studio source').value,
    ).toBe(other.datasetId)
    definitions = [
      {
        id: 'delayed',
        name: 'Pinned recovery',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        version: 1,
        source_revisions: [],
        created_at: '',
        updated_at: '',
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [
            { datasetId: DATASET.datasetId, datasetVersionId: snapshotId },
          ],
          value: { fieldId: FIELD_RECOVERY },
        },
      },
    ]
    releaseDefinitions?.()
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>('Studio source').value,
      ).toBe(DATASET.datasetId),
    )
    expect(screen.getByDisplayValue('Pinned recovery')).toBeTruthy()
    expect(screen.getByText(/Reading (a )?snapshot/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Analysis name'), {
      target: { value: 'Keep edits' },
    })
    await client.invalidateQueries({ queryKey: ['analysis-definitions'] })
    expect(screen.getByDisplayValue('Keep edits')).toBeTruthy()
    expect(screen.getByText(/Reading (a )?snapshot/)).toBeTruthy()
    await choose(userEvent.setup(), 'Analysis dataset', /Other dataset/)
    await client.invalidateQueries({ queryKey: ['analysis-definitions'] })
    expect(
      screen.getByLabelText<HTMLSelectElement>('Studio source').value,
    ).toBe(other.datasetId)
    expect(screen.queryByText(/Reading (a )?snapshot/)).toBeNull()
  })

  it('surfaces an honest execution error for an empty dataset', async () => {
    rows = []
    await runDescriptive()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/dataset has no rows/i)
  })

  it('shows a changed-source error instead of presenting scientific results', async () => {
    changedSource = true
    renderPanel()
    await choose(userEvent.setup(), 'Analysis dataset', /Stability/)
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Dataset changed/,
    )
    expect(
      screen.queryByRole('table', { name: 'Descriptive statistics per group' }),
    ).toBeNull()
  })

  it('adopts a saved analysis immediately for citation and subsequent updates', async () => {
    await runDescriptive()

    const save = screen.getByRole('button', {
      name: /^Save$/,
    })

    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Analysis name'), {
      target: { value: 'Recovery summary' },
    })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(
      await screen.findByRole('button', { name: /Cite in a notebook/ }),
    ).toBeTruthy()
    expect(screen.getByText('median')).toBeTruthy()
    expect(screen.getByLabelText('Analysis dataset').textContent).toContain(
      'Stability',
    )
    fireEvent.click(screen.getByRole('button', { name: /^Update$/ }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1].id).toBe('saved')
  })

  it('lists saved analyses and loads one back into the editor', async () => {
    definitions = [
      {
        id: 'def-1',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Recovery summary',
        version: 3,
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET.datasetId }],
          value: { fieldId: FIELD_RECOVERY },
          group: { fieldId: FIELD_CONDITION },
        },
        source_revisions: [],
        created_at: '',
        updated_at: '',
      },
    ]
    renderPanel()
    await screen.findByText('Recovery summary')
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Measured value column')).toBeTruthy(),
    )
    expect(screen.getByDisplayValue('Recovery summary')).toBeTruthy()
  })

  it('deletes a saved analysis only after the confirmation', async () => {
    definitions = [
      {
        id: 'def-1',
        workspace_id: 'ws-1',
        owner_user_id: 'user-1',
        name: 'Recovery summary',
        version: 3,
        definition: {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET.datasetId }],
          value: { fieldId: FIELD_RECOVERY },
          group: { fieldId: FIELD_CONDITION },
        },
        source_revisions: [],
        created_at: '',
        updated_at: '',
      },
    ]
    renderPanel()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Recovery summary' }),
    )
    // The row action asks first: nothing is deleted until the dialog's action.
    expect(deleted).toEqual([])
    expect(screen.getByText('Delete this saved analysis?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toEqual(['def-1']))
  })

  it('states the method and its checks alongside the numbers', async () => {
    await runDescriptive()
    // R5-STUDIO-01: the result names the model it ran, its version and its
    // runner before any number is read.
    expect(screen.getByText('One-way ANOVA')).toBeTruthy()
    expect(screen.getByText('method v1')).toBeTruthy()
    expect(screen.getByText('sheetbase-analysis-kernel@1')).toBeTruthy()
    expect(screen.getByText('Between groups')).toBeTruthy()
    expect(screen.getByText('Assumption checks')).toBeTruthy()
    // Four observations cannot support Jarque–Bera; the check says so rather
    // than reporting a pass.
    expect(
      screen.getByText(/Jarque–Bera needs at least 8 residuals/),
    ).toBeTruthy()
  })
})

describe('AnalysisResultTable', () => {
  it('preserves duplicate read-back rows and replaces their text without retained row state', () => {
    const definition: Extract<AnalysisDefinition, { kind: 'curve' }> = {
      definitionVersion: 1,
      kind: 'curve',
      datasets: [{ datasetId: DATASET.datasetId }],
      dose: { fieldId: FIELD_TIME },
      response: { fieldId: FIELD_RECOVERY },
      label: { fieldId: FIELD_CONDITION },
    }

    const response = (dose: number) =>
      2.4 + (0.05 - 2.4) / (1 + (dose / 20) ** 1.4)

    const standards = [0.5, 1.5, 5, 15, 50, 150, 500, 1500].map((dose) => ({
      [FIELD_TIME]: dose,
      [FIELD_RECOVERY]: response(dose),
      [FIELD_CONDITION]: null,
    }))

    const unknown = {
      [FIELD_TIME]: null,
      [FIELD_RECOVERY]: response(80),
      [FIELD_CONDITION]: 'duplicate',
    }

    const first = runAnalysis(definition, DATASET.columns, [
      ...standards,
      unknown,
      unknown,
    ])

    const second = runAnalysis(definition, DATASET.columns, [
      ...standards,
      {
        ...unknown,
        [FIELD_CONDITION]: 'replacement',
        [FIELD_RECOVERY]: response(5),
      },
    ])

    if (
      !first.ok ||
      !second.ok ||
      first.result.kind !== 'curve' ||
      second.result.kind !== 'curve'
    )
      throw new Error('Expected curve results')
    expect(first.result.rows[0].readBack.slice(-2)).toEqual([
      first.result.rows[0].readBack.at(-1),
      first.result.rows[0].readBack.at(-1),
    ])
    const { rerender } = render(<AnalysisResultTable result={first.result} />)

    const table = screen.getByRole('table', {
      name: 'Standards and unknowns read back through the curve',
    })

    expect(within(table).getAllByText('duplicate')).toHaveLength(2)
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(table).queryAllByRole('button')).toHaveLength(0)
    rerender(<AnalysisResultTable result={second.result} />)
    expect(within(table).queryAllByText('duplicate')).toHaveLength(0)
    expect(within(table).getByText('replacement')).toBeTruthy()
    expect(within(table).getAllByRole('row')).toHaveLength(10)
    expect(within(table).getAllByRole('row').at(-1)?.textContent).toContain(
      'Unknown',
    )
  })

  it('keeps finite numeric cells and refuses grouped regression overlays', () => {
    const definition: Extract<AnalysisDefinition, { kind: 'regression' }> = {
      definitionVersion: 1,
      kind: 'regression',
      datasets: [{ datasetId: DATASET.datasetId }],
      outcome: { fieldId: FIELD_RECOVERY },
      predictor: { fieldId: FIELD_TIME },
      degree: 1,
    }

    const result = runAnalysis(definition, DATASET.columns, [
      { [FIELD_TIME]: 1, [FIELD_RECOVERY]: 10 },
      { [FIELD_TIME]: 2, [FIELD_RECOVERY]: 20 },
      { [FIELD_TIME]: 3, [FIELD_RECOVERY]: 30 },
    ])

    if (!result.ok || result.result.kind !== 'regression')
      throw new Error('expected a regression result')
    const fit = result.result.rows[0]

    const chart = buildRegressionFitChart({
      definition,
      fit,
      rows: [
        { [FIELD_TIME]: ' 1 ', [FIELD_RECOVERY]: '10' },
        { [FIELD_TIME]: 2, [FIELD_RECOVERY]: 20 },
        ...[
          null,
          undefined,
          true,
          '',
          ' ',
          'Infinity',
          Infinity,
          NaN,
          [],
          {},
        ].map((value) => ({ [FIELD_TIME]: value, [FIELD_RECOVERY]: 30 })),
      ],
    })

    expect(
      chart?.materialised.series[0].points.map(({ x, y }) => ({ x, y })),
    ).toEqual([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ])
    expect(chart?.materialised.series[1].renderAs).toBe('line')
    expect(
      buildRegressionFitChart({
        definition: { ...definition, group: { fieldId: FIELD_CONDITION } },
        fit,
        rows: [],
      }),
    ).toBeNull()
  })

  it('renders the term table, the method and a failed check as it stands', () => {
    // Deliberately heteroscedastic: the residual spread is far larger over
    // the second half, so the constant-variance check must fail visibly.
    const noise = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 8, -8, 8, -8, 8, -8]

    const definition: AnalysisDefinition = {
      definitionVersion: 1,
      kind: 'regression',
      datasets: [{ datasetId: DATASET.datasetId }],
      outcome: { fieldId: FIELD_RECOVERY },
      predictor: { fieldId: FIELD_TIME },
      degree: 1,
    }

    const columns: ChartColumn[] = [
      { id: FIELD_TIME, label: 'Time (h)', logicalType: 'decimal' },
      { id: FIELD_RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
    ]

    const regressionRows = noise.map((d, index) => ({
      [FIELD_TIME]: index + 1,
      [FIELD_RECOVERY]: index + 1 + d,
    }))

    const result = runAnalysis(definition, columns, regressionRows)

    if (!result.ok) throw new Error('expected a regression result')
    render(<AnalysisResultTable result={result.result} />)

    expect(
      screen.getByText('Linear model (ordinary least squares)'),
    ).toBeTruthy()
    expect(screen.getByText('Term')).toBeTruthy()
    expect(screen.getByText('95% CI')).toBeTruthy()
    expect(screen.getByText('Intercept')).toBeTruthy()
    expect(
      screen.getByText(/Fails · Residual variance is constant/),
    ).toBeTruthy()
    expect(
      screen.getByText(/transform(ing)? the outcome or weighting the fit/),
    ).toBeTruthy()
  })
})
