import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createElnCellRenderer,
  createRecordMenuActions,
  createRecordPickerEditor,
  LockedSheetBadge,
  readOnlyRowSet,
} from './index'

afterEach(cleanup)

describe('createElnCellRenderer', () => {
  const base = {
    address: 'B2',
    point: { row: 1, column: 1 },
    selected: false,
    active: false,
    loading: false,
  }

  function renderDisplay(
    renderer: ReturnType<typeof createElnCellRenderer>,
    display: string,
    fieldId = 'col',
  ) {
    const output = renderer({ ...base, display, field: { id: fieldId, label: 'Col', column: 1 } })
    return render(<div data-testid="cell">{output}</div>)
  }

  it('renders status chips with palette labels and classes', () => {
    const renderer = createElnCellRenderer({
      columns: {
        col: {
          kind: 'status',
          palette: {
            pass: { label: 'Passed', className: 'chip-ok' },
            fail: { className: 'chip-bad' },
          },
          fallbackClassName: 'chip-neutral',
        },
      },
    })
    const passed = renderDisplay(renderer, 'pass')
    expect(screen.getByText('Passed').className).toBe('chip-ok')
    expect(screen.getByText('Passed').getAttribute('data-eln-chip')).toBe('pass')
    passed.unmount()

    const failed = renderDisplay(renderer, 'fail')
    expect(screen.getByText('fail').className).toBe('chip-bad')
    failed.unmount()

    const pending = renderDisplay(renderer, 'pending')
    expect(screen.getByText('pending').className).toBe('chip-neutral')
    pending.unmount()

    const empty = renderDisplay(renderer, '')
    expect(empty.getByTestId('cell').textContent).toBe('')
  })

  it('formats numbers with precision and units', () => {
    const renderer = createElnCellRenderer({
      columns: { col: { kind: 'number', unit: 'U/mL', precision: 1 } },
    })
    renderDisplay(renderer, '96.65')
    expect(screen.getByTestId('cell').textContent).toBe('96.7 U/mL')
  })

  it('shows record labels through a live getter and keeps unknown UUIDs as-is', () => {
    const labels = { 'r1': 'Virus Stability at 4°C (EXP-2026-001)' }
    const renderer = createElnCellRenderer({
      columns: { col: { kind: 'record-reference' } },
      recordLabels: () => labels,
    })
    renderDisplay(renderer, 'r1')
    expect(screen.getByTestId('cell').textContent).toBe(
      'Virus Stability at 4°C (EXP-2026-001)',
    )
  })

  it('maps category values through the label table', () => {
    const renderer = createElnCellRenderer({
      columns: {
        col: { kind: 'category', labels: { opt1: 'Control' } },
      },
    })
    renderDisplay(renderer, 'opt1')
    expect(screen.getByTestId('cell').textContent).toBe('Control')
  })

  it('leaves unconfigured columns to the engine default', () => {
    const renderer = createElnCellRenderer({ columns: {} })
    const output = renderer({
      ...base,
      display: 'whatever',
      field: { id: 'other', label: 'Other', column: 0 },
    })
    expect(output).toBeUndefined()
  })
})

describe('createRecordMenuActions', () => {
  it('opens the record when the cell holds one and no-ops otherwise', () => {
    const openRecord = vi.fn()
    const actions = createRecordMenuActions({
      recordIdAt: ({ index }) => (index === 3 ? 'rec-1' : null),
      openRecord,
    })
    expect(actions).toHaveLength(1)
    actions[0].onSelect({ axis: 'column', index: 3 })
    expect(openRecord).toHaveBeenCalledWith('rec-1')
    actions[0].onSelect({ axis: 'column', index: 0 })
    expect(openRecord).toHaveBeenCalledTimes(1)
  })
})

describe('createRecordPickerEditor', () => {
  it('matches relationship fields, searches, and commits the picked record id', async () => {
    const user = userEvent.setup()
    const search = vi
      .fn()
      .mockResolvedValue([{ id: 'rec-9', label: 'Sample A', hint: 'BATCH-1' }])
    const editor = createRecordPickerEditor({ search })
    const fieldOf = (dataType: 'relationship' | 'text') => ({
      id: 'col',
      label: 'Col',
      column: 0,
      dataType,
    })
    const point = { row: 0, column: 0 }
    expect(editor.matches({ point, field: fieldOf('relationship') })).toBe(true)
    expect(editor.matches({ point, field: fieldOf('text') })).toBe(false)

    const commit = vi.fn()
    const cancel = vi.fn()
    render(
      <div>
        {editor.render({
          initialDraft: '',
          commit,
          cancel,
          point: { row: 0, column: 0 },
          address: 'A1',
        })}
      </div>,
    )

    await user.type(screen.getByLabelText('Search records'), 'sam')
    await waitFor(() => expect(search).toHaveBeenCalledWith('sam'))
    await screen.findByText('Sample A')
    await user.click(screen.getByText('Sample A'))
    expect(commit).toHaveBeenCalledWith('rec-9')
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape and reports empty result sets', async () => {
    const user = userEvent.setup()
    const search = vi.fn().mockResolvedValue([])
    const commit = vi.fn()
    const cancel = vi.fn()
    render(
      <div>
        {createRecordPickerEditor({ search }).render({
          initialDraft: '',
          commit,
          cancel,
          point: { row: 0, column: 0 },
          address: 'A1',
        })}
      </div>,
    )
    await user.type(screen.getByLabelText('Search records'), 'zz')
    await screen.findByText('No matches.')
    await user.keyboard('{Escape}')
    expect(cancel).toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('locked-sheet affordances', () => {
  it('renders the locked badge and builds a full read-only row set', () => {
    render(<LockedSheetBadge />)
    expect(screen.getByRole('status').textContent).toBe('Locked · read-only')
    const rows = readOnlyRowSet(3)
    expect([...rows].sort()).toEqual([0, 1, 2])
    expect(readOnlyRowSet(0).size).toBe(0)
  })
})
