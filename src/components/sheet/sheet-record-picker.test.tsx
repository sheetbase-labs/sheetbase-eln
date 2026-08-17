import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookRecord } from '#/lib/notebook-data'
import {
  SheetRecordPicker,
  sheetRecordPickerKind,
  sheetRecordSelectionLabel,
} from './sheet-record-picker'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView = () => {}

afterEach(cleanup)

const sample: NotebookRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'p-1',
  kind: 'sample',
  identifier: 'SMP-2026-0001',
  title: 'LV harvest',
  status: 'available',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u-1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

describe('Sheet Record picker', () => {
  it('reuses the Sample picker and reports UUID identity on keyboard selection', async () => {
    expect(sheetRecordPickerKind('sample')).toBe('sample')
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <SheetRecordPicker
        modelKey="sample"
        results={[sample]}
        loading={false}
        onSearch={vi.fn()}
        onSelect={onSelect}
      />,
    )
    screen.getByRole('combobox').focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sample.id,
        identifier: 'SMP-2026-0001',
      }),
    )
    expect(sheetRecordSelectionLabel(onSelect.mock.calls[0][0])).toBe(
      'SMP-2026-0001 · LV harvest',
    )
  })

  it('searches Records for a Definition Model that is not sample', async () => {
    expect(sheetRecordPickerKind('batch')).toBeNull()
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <SheetRecordPicker
        modelKey="batch"
        results={[
          {
            ...sample,
            kind: 'batch',
            identifier: 'BAT-2026-0001',
            title: 'Lot A',
          },
        ]}
        loading={false}
        onSearch={vi.fn()}
        onSelect={onSelect}
      />,
    )
    screen.getByRole('combobox').focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'BAT-2026-0001',
      }),
    )
  })
})
