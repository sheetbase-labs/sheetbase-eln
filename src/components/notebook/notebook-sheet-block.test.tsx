import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

import {
  FrozenSheetEvidencePanel,
  NotebookSheetBlock,
  sheetInstanceEmbedErrorMessage,
} from './notebook-sheet-block'

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
})

describe('NotebookSheetBlock', () => {
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
