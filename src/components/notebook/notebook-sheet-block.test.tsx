import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DataClientError } from '#/lib/data-client'
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

import {
  FrozenSheetEvidencePanel,
  NotebookSheetBlock,
  sheetInstanceEmbedErrorMessage,
} from './notebook-sheet-block'

vi.mock('#/components/sheet/canonical-sheet-workspace', () => ({
  CanonicalSheetWorkspace: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid="live-workspace" data-read-only={String(readOnly)} />
  ),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: () => <span>Open full sheet</span>,
}))

afterEach(() => cleanup())

const record: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Virus Stability at 4C',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const fieldId = '10000000-0000-4000-8000-000000000004'
const rowId = '10000000-0000-4000-8000-000000000005'

const frozen: FrozenSheetEvidence = {
  blockId: 'b1',
  instanceId: '20000000-0000-4000-8000-000000000001',
  instanceRevision: 3,
  sourceDefinitionVersionId: null,
  instanceState: {
    localFields: [{ fieldId, key: 'observation', label: 'Observation' }],
    localValues: { [rowId]: { [fieldId]: 'independent value' } },
    presentation: { columnOrder: [fieldId], hiddenColumnIds: [] },
  },
  datasetBindings: [],
}

describe('FrozenSheetEvidencePanel', () => {
  it('renders a labelled read-only grid without Instance UUIDs', () => {
    render(<FrozenSheetEvidencePanel evidence={frozen} />)
    expect(
      screen.getByRole('region', { name: 'Frozen Sheet evidence' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    expect(screen.getByText('independent value')).toBeTruthy()
    expect(screen.getByRole('status').textContent).not.toContain(
      frozen.instanceId,
    )
    expect(screen.queryByText('Technical detail')).toBeNull()
  })

  it('selects stable submitted cell, row and range identities in asymmetric display order', () => {
    const onCommentTarget = vi.fn()
    const secondRow = '10000000-0000-4000-8000-000000000006'
    const secondField = '10000000-0000-4000-8000-000000000007'
    render(
      <FrozenSheetEvidencePanel
        evidence={{
          ...frozen,
          composedGrid: {
            columns: [
              { id: secondField, label: 'Yield' },
              { id: fieldId, label: 'Sample' },
            ],
            rowKeys: [secondRow, rowId],
            rows: [
              ['94', 'B'],
              ['13', 'A'],
            ],
          },
        }}
        onCommentTarget={onCommentTarget}
      />,
    )
    const submit = screen.getByRole('button', {
      name: 'Comment on frozen selection',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select Sample row 1' }))
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(1)
    fireEvent.click(submit)
    expect(onCommentTarget).toHaveBeenLastCalledWith({
      targetKind: 'sheet_cell',
      target: {
        instanceId: frozen.instanceId,
        rowKeys: [secondRow],
        fieldIds: [fieldId],
      },
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Frozen comment target' }),
      { target: { value: 'sheet_row' } },
    )
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(2)
    fireEvent.click(submit)
    expect(onCommentTarget).toHaveBeenLastCalledWith({
      targetKind: 'sheet_row',
      target: {
        instanceId: frozen.instanceId,
        rowKeys: [secondRow],
        fieldIds: [],
      },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Select Yield row 2' }),
      { shiftKey: true },
    )
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Frozen comment target' }),
      { target: { value: 'sheet_range' } },
    )
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(4)
    expect(screen.getByText('Selected target: 2 rows · 2 fields')).toBeTruthy()
    fireEvent.click(submit)
    expect(onCommentTarget).toHaveBeenLastCalledWith({
      targetKind: 'sheet_range',
      target: {
        instanceId: frozen.instanceId,
        rowKeys: [rowId, secondRow],
        fieldIds: [fieldId, secondField],
      },
    })
  })

  it('shows positional historical values without inventing selectable identities', () => {
    const onCommentTarget = vi.fn()
    render(
      <FrozenSheetEvidencePanel
        evidence={{
          ...frozen,
          composedGrid: {
            columns: [{ id: fieldId, label: 'Observation' }],
            rows: [['historical value']],
          },
        }}
        onCommentTarget={onCommentTarget}
      />,
    )
    expect(screen.getByText('historical value')).toBeTruthy()
    expect(screen.getByText(/Cell comments are not available/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Select/ })).toBeNull()
    expect(onCommentTarget).not.toHaveBeenCalled()
  })
})

describe('NotebookSheetBlock', () => {
  const sheetBlock: NotebookBlock = {
    id: 'b1',
    recordId: record.id,
    type: 'sheet',
    payload: { instanceId: frozen.instanceId },
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }

  it.each([
    {
      record: { ...record, lockedAt: '2026-10-04T12:00:00Z' },
      evidence: undefined,
    },
    { record, evidence: null },
  ])(
    'does not mount live queries when locked or historical evidence is missing',
    ({ record: notebook, evidence }) => {
      render(
        <NotebookSheetBlock
          block={sheetBlock}
          record={notebook}
          readOnly
          frozenEvidence={evidence}
        />,
      )
      expect(screen.getByRole('status').textContent).toContain(
        'Frozen Sheet evidence is unavailable',
      )
      expect(screen.queryByTestId('live-workspace')).toBeNull()
    },
  )

  it('uses frozen evidence even when the historical block has no live Instance address', () => {
    render(
      <NotebookSheetBlock
        block={{ ...sheetBlock, payload: {} }}
        record={record}
        frozenEvidence={frozen}
      />,
    )
    expect(screen.getByText('independent value')).toBeTruthy()
    expect(screen.queryByTestId('live-workspace')).toBeNull()
  })

  it.each([true, false])(
    'preserves a legitimate live preview with readOnly=%s',
    (readOnly) => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      client.setQueryData(['sheet-instance', frozen.instanceId], {
        lifecycle: 'active',
        sourceDefinitionVersionId: null,
        name: 'Live preview',
      })
      client.setQueryData(['sheet-instance-embeddings', frozen.instanceId], {
        embeddings: [],
        count: 1,
      })
      render(
        <QueryClientProvider client={client}>
          <NotebookSheetBlock
            block={sheetBlock}
            record={record}
            readOnly={readOnly}
          />
        </QueryClientProvider>,
      )
      expect(
        screen.getByTestId('live-workspace').getAttribute('data-read-only'),
      ).toBe(String(readOnly))
      client.clear()
    },
  )

  it('does not offer a conversion path when the block has no Instance', () => {
    const block: NotebookBlock = {
      id: 'b1',
      recordId: record.id,
      type: 'sheet',
      payload: {},
      payloadSchemaVersion: 1,
      order: 1,
      version: 1,
    }
    render(<NotebookSheetBlock block={block} record={record} />)
    expect(screen.getByText('This block has no Sheet Instance.')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Convert to Sheet Instance' }),
    ).toBeNull()
  })
})

describe('sheetInstanceEmbedErrorMessage', () => {
  it('distinguishes permission, missing, and parse failures', () => {
    expect(
      sheetInstanceEmbedErrorMessage(
        new DataClientError('forbidden', 'no', 403),
        false,
      ),
    ).toMatch(/permission/)
    expect(sheetInstanceEmbedErrorMessage(undefined, true)).toMatch(
      /could not be found/,
    )
    expect(
      sheetInstanceEmbedErrorMessage(
        Object.assign(new Error('Invalid input'), { name: 'ZodError' }),
        false,
      ),
    ).toMatch(/expected format/)
  })
})
