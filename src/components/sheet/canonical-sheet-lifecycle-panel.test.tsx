import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetDefinitionVersionWire } from '#/lib/sheet-definition-data'
import { sheetDefinitionExtractionSelectionSchema } from '#/lib/sheet-definition-extraction'
import type { SheetDefinitionExtractionSelection } from '#/lib/sheet-definition-extraction'
import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import { CanonicalSheetLifecyclePanel } from './canonical-sheet-lifecycle-panel'
import { lifecycleErrorText } from './sheet-lifecycle-helpers'
import { renderSheetRoute } from './sheet-test-router'

const INSTANCE = '20000000-0000-4000-8000-000000000001'
const VERSION = '20000000-0000-4000-8000-000000000010'
const DATASET = '20000000-0000-4000-8000-000000000011'

function instance(): SheetInstance {
  return {
    id: INSTANCE,
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000004',
    sourceDefinitionVersionId: null,
    name: 'Assay observations',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

function version(id: string, number: number): SheetDefinitionVersionWire {
  return {
    id,
    definition_id: 'definition-1',
    version: number,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: validSheetDefinitionConfiguration(),
    revision: 1,
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z',
    created_by_user_id: 'u1',
    updated_by_user_id: 'u1',
    published_at: '2026-08-20T12:00:00.000Z',
    published_by_user_id: 'u1',
    retired_at: null,
    retired_by_user_id: null,
  }
}

function extractionPreview(selection: SheetDefinitionExtractionSelection) {
  return {
    source: { instanceId: INSTANCE, instanceRevision: 1 },
    selection,
    configuration: validSheetDefinitionConfiguration(),
    manifest: {
      reusable: {
        parameterIds: [],
        bindingIds: [],
        sourceColumnIds: [],
        joinIds: [],
        localFieldIds: [],
        calculationIds: [],
        presentationDefaultsIncluded: true,
      },
      excluded: {
        concreteBindingValueBindingIds: [],
        unselectedSourceColumnIds: [],
        unselectedJoinIds: [],
        unselectedLocalFieldIds: [],
        unselectedCalculationIds: [],
        localValues: { rowCount: 0, cellCount: 0 },
        calculationOverrideIds: [],
        calculationResults: 'all',
        writeBackRuleIds: [],
        actionIds: [],
        presentationValueFilterCount: 0,
        presentationOutOfRangeWidthColumnIds: [],
        rowIdentitiesDerivedFromValues: 'all',
      },
    },
  }
}

async function renderPanel(
  options: {
    pinned?: string
    versions?: SheetDefinitionVersionWire[]
    extractionName?: string
  } = {},
) {
  const calls: string[] = []
  const selections: SheetDefinitionExtractionSelection[] = []

  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    if (url.pathname.endsWith('/sheet_definition_versions')) {
      const rows = options.versions ?? []
      const id = url.searchParams.get('id')?.replace('eq.', '')

      return Response.json(id ? rows.filter((row) => row.id === id) : rows)
    }

    if (!url.pathname.includes('/rpc/')) return Response.json([])
    const name = url.pathname.split('/').at(-1) ?? ''
    calls.push(name)

    if (
      name === 'preview_sheet_definition_extraction' ||
      name === 'extract_sheet_definition_draft'
    ) {
      const { p_selection } = z
        .object({ p_selection: sheetDefinitionExtractionSelectionSchema })
        .parse(await new Response(init?.body).json())

      if (name === 'preview_sheet_definition_extraction')
        return Response.json(extractionPreview(p_selection))
      selections.push(p_selection)

      return Response.json({
        definition: {
          id: 'definition-1',
          workspace_id: instance().workspaceId,
          key: 'assay_results',
          name: options.extractionName ?? 'Assay definition',
          description: null,
          lifecycle: 'active',
          revision: 1,
          created_at: instance().createdAt,
          updated_at: instance().updatedAt,
          created_by_user_id: 'u1',
          updated_by_user_id: 'u1',
        },
        version: { ...version('version-1', 1), lifecycle: 'draft' },
        preview: extractionPreview(p_selection),
      })
    }

    if (name === 'preview_sheet_materialization') {
      const configuration = validSheetDefinitionConfiguration()
      const field = validSheetInstanceState().localFields[0]

      return Response.json({
        instanceId: INSTANCE,
        instanceRevision: 1,
        definitionVersionId: VERSION,
        outputSchemaVersionId: null,
        derivedOutputFields: [
          { id: field.fieldId, kind: 'local-field', field },
        ],
        sourceVersions: [
          {
            bindingId: configuration.bindings[0].id,
            datasetId: DATASET,
            datasetRevision: 1,
            schemaVersionId: VERSION,
            pinKind: 'live-snapshot',
            datasetVersionId: null,
            policy: { mode: 'live' },
          },
        ],
        previewDigest: 'a'.repeat(64),
      })
    }

    if (name === 'materialize_sheet_instance')
      return Response.json({
        materializationId: VERSION,
        datasetId: DATASET,
        datasetVersionId: VERSION,
        idempotent: false,
      })

    if (name === 'publish_sheet_definition_version')
      return Response.json(version('version-1', 1))
    throw new Error(`Unexpected RPC: ${name}`)
  })

  const rendered = await renderSheetRoute(
    <CanonicalSheetLifecyclePanel
      instance={{
        ...instance(),
        sourceDefinitionVersionId: options.pinned ?? null,
      }}
      client={createDataClient(fetcher)}
      onInstance={vi.fn()}
    />,
  )

  return { ...rendered, calls, selections, fetcher }
}

afterEach(cleanup)

describe('CanonicalSheetLifecyclePanel', () => {
  it('extracts bound structure and row identity from the pinned Definition without concrete Dataset values', async () => {
    const configuration = validSheetDefinitionConfiguration()

    const { selections } = await renderPanel({
      pinned: VERSION,
      versions: [version(VERSION, 1)],
    })

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.click(screen.getByRole('button', { name: 'Extract draft' }))
    await screen.findByRole('link', { name: 'Review sheet definition' })
    expect(selections[0]).toMatchObject({
      bindings: configuration.bindings.map((binding) => ({
        bindingId: binding.id,
        key: binding.key,
        parameter: configuration.parameters.find(
          (parameter) => parameter.id === binding.parameterId,
        ),
      })),
      columnIds: configuration.columns
        .filter((column) => column.source.kind !== 'calculated')
        .map((column) => column.id),
      joinIds: configuration.joins.map((join) => join.id),
      rowIdentity: configuration.rowIdentity,
    })
  })

  it('takes an extracted Definition directly to its governed configuration', async () => {
    const { calls } = await renderPanel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.type(screen.getByLabelText('Definition key'), 'assay_results')
    await user.click(screen.getByRole('button', { name: 'Extract draft' }))

    const link = await screen.findByRole('link', {
      name: 'Review sheet definition',
    })

    expect(link.getAttribute('href')).toContain(
      '/sheet-definitions/definition-1?version=version-1&returnTo=%2Fsheets%2F',
    )
    expect(
      calls.filter((name) => name === 'extract_sheet_definition_draft'),
    ).toHaveLength(1)
  })

  it('surfaces an upgrade badge when a newer published Definition version exists', async () => {
    await renderPanel({
      pinned: 'pinned-version-1',
      versions: [
        version('pinned-version-1', 1),
        version('pinned-version-2', 2),
      ],
    })
    expect(await screen.findByText('Upgrade available · v2')).toBeTruthy()
  })

  it('stays silent when the pinned Definition version is current', async () => {
    const { fetcher } = await renderPanel({
      pinned: 'pinned-version-2',
      versions: [
        version('pinned-version-1', 1),
        version('pinned-version-2', 2),
      ],
    })

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining('definition_id=eq.definition-1'),
        expect.any(Object),
      ),
    )
    expect(screen.queryByText(/Upgrade available/)).toBeNull()
  })

  it('writes no Dataset until the confirmation is accepted, and none on cancel', async () => {
    const { calls } = await renderPanel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(calls).not.toContain('preview_sheet_materialization')
    expect(calls).not.toContain('materialize_sheet_instance')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).not.toContain('materialize_sheet_instance')
  })

  it('lands on the new dataset after materialising', async () => {
    const { queryClient } = await renderPanel()
    queryClient.setQueryData(['dataset-explorer-summaries', 'other-view'], [])
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const link = await screen.findByRole('link', {
      name: 'Open the new dataset',
    })

    expect(link.getAttribute('href')).toBe(`/datasets/${DATASET}`)
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['dataset-explorer-summaries', 'other-view'])
          ?.isInvalidated,
      ).toBe(true),
    )
  })

  it('publishes no Definition until the extract-and-publish confirmation is accepted', async () => {
    const { calls } = await renderPanel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Extract and publish' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(calls).not.toContain('extract_sheet_definition_draft')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).not.toContain('extract_sheet_definition_draft')
  })

  it('refreshes the published lineage only after the confirmed publication succeeds', async () => {
    const { calls, queryClient } = await renderPanel()
    queryClient.setQueryData(['sheet-definition-versions', 'definition-1'], [])
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Link data and reuse this sheet' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Extract and publish' }),
    )
    expect(
      queryClient.getQueryState(['sheet-definition-versions', 'definition-1'])
        ?.isInvalidated,
    ).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Extract and publish' }),
    )
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['sheet-definition-versions', 'definition-1'])
          ?.isInvalidated,
      ).toBe(true),
    )
    expect(calls).toEqual([
      'preview_sheet_definition_extraction',
      'extract_sheet_definition_draft',
      'publish_sheet_definition_version',
    ])
  })
})

describe('lifecycleErrorText', () => {
  it('points a local-only sheet at promotion instead of the server code', () => {
    expect(
      lifecycleErrorText('active Definition-backed Sheet Instance required'),
    ).toMatch(/add a column to a dataset/)
    expect(
      lifecycleErrorText(
        'invalid extracted Definition configuration: local row identity must be one declared reference UUID column',
      ),
    ).toMatch(/add a column to a dataset/)
  })
  it('leaves any other refusal as the server wrote it', () => {
    expect(lifecycleErrorText('stale revision')).toBe('stale revision')
  })
})
