import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordPicker } from './record-picker'
import type * as PickerData from './record-picker-data'
import type { PickerItem, PickerResult } from './record-picker-data'

const mocks = vi.hoisted(() => {
  const sample: PickerItem = {
    id: 'smp-1',
    name: 'Virus stock A',
    kind: 'Sample',
    status: { tone: 'ok', label: 'In stock' },
    project: '',
  }
  const dataset: PickerItem = {
    id: 'ds-1',
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
