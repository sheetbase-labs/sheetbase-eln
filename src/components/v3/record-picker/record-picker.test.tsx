import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordPicker } from './record-picker'
import { toPickerItem } from './record-picker-data'
import type * as PickerData from './record-picker-data'
import type { PickerItem, PickerResult } from './record-picker-data'
import { toSearchResult } from '#/lib/search'

const mocks = vi.hoisted(() => {
  const sample: PickerItem = {
    id: 'smp-1',
    identifier: 'SMP-2249',
    name: 'Virus stock A',
    kind: 'Sample',
    status: { tone: 'ok', label: 'In stock' },
    project: '',
  }
  const dataset: PickerItem = {
    id: 'ds-1',
    identifier: 'DS-0311',
    name: 'Stability DS',
    kind: 'Dataset',
    status: { tone: 'none', label: '—' },
    project: '',
  }
  const searchPickerRecords = vi.fn(
    async (_input: { q: string; kinds?: string[] }): Promise<PickerResult> => ({
      recent: false,
      items: [sample, dataset],
      counts: { Sample: 1, Material: 0, Dataset: 1, Experiment: 0 },
      total: 2,
    }),
  )
  return { sample, dataset, searchPickerRecords }
})

vi.mock('./record-picker-data', async () => {
  const actual = await vi.importActual<typeof PickerData>(
    './record-picker-data',
  )
  return { ...actual, searchPickerRecords: mocks.searchPickerRecords }
})

const { sample, dataset, searchPickerRecords } = mocks

afterEach(() => {
  cleanup()
  searchPickerRecords.mockClear()
})

describe('RecordPicker', () => {
  it('never uses a comment UUID as a selectable Sample record', () => {
    const comment = '56000000-0000-4000-8000-000000000041'
    const owner = '56000000-0000-4000-8000-000000000042'
    expect(
      toPickerItem(
        toSearchResult({
          result_type: 'comment',
          record_id: comment,
          kind: 'sample',
          identifier: 'Comment',
          title: 'Sample evidence discussion',
          status: 'open',
          project_id: null,
          archived: false,
          created_by_user_id: 'user',
          created_at: '2026-10-04T00:00:00Z',
          updated_at: '2026-10-04T00:00:00Z',
          matched_context: 'Sample evidence discussion',
          matched_field: 'comment_body',
          rank: '1',
          total_count: '1',
          deep_link: `/sheets/${owner}?commentId=${comment}`,
        }),
      ),
    ).toBeNull()
  })

  it('lists the results grouped by kind', async () => {
    render(<RecordPicker onPick={vi.fn()} />)
    expect(await screen.findByText('Virus stock A')).toBeTruthy()
    expect(screen.getByText('Stability DS')).toBeTruthy()
    expect(screen.getAllByText('Samples').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Datasets').length).toBeGreaterThan(0)
  })

  it('shows already-linked records as Linked and disables them', async () => {
    render(<RecordPicker onPick={vi.fn()} exclude={['smp-1']} />)
    const linked = await screen.findByText('Linked')
    expect(linked).toBeTruthy()
    expect(
      screen
        .getByText('Virus stock A')
        .closest('[data-command-item]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('picks a single record on select', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<RecordPicker onPick={onPick} />)
    await user.click(await screen.findByText('Virus stock A'))
    expect(onPick).toHaveBeenCalledWith([sample])
  })

  it('multi-select confirms the chosen records', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(
      <RecordPicker
        onPick={onPick}
        multiple
        confirmLabel={(n) => `Link ${n}`}
      />,
    )
    await user.click(await screen.findByText('Virus stock A'))
    await user.click(screen.getByText('Stability DS'))
    const confirm = screen.getByRole('button', { name: 'Link 2' })
    await user.click(confirm)
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(onPick.mock.calls[0]?.[0]).toEqual([sample, dataset])
  })
})
