/**
 * SCI-005 component tests for the extended PlateMap: arrow navigation,
 * well-code selection, role legend, and missing/empty distinction.
 */
import type { ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlateMap } from './plate-map'
import type { PlateWell } from './plate-map'

afterEach(() => cleanup())

const roleWells: PlateWell[] = [
  {
    row: 0,
    col: 0,
    wellCode: 'A1',
    roleClass: 'bg-blue-300',
    displayLabel: 'S',
    label: 'A1 Sample',
  },
  {
    row: 0,
    col: 1,
    wellCode: 'A2',
    roleClass: 'bg-emerald-400',
    displayLabel: 'P',
    label: 'A2 Positive control',
  },
  {
    row: 1,
    col: 0,
    wellCode: 'B1',
    roleClass: 'bg-orange-400',
    displayLabel: 'N',
    label: 'B1 Negative control',
  },
  { row: 1, col: 1, wellCode: 'B2', label: 'B2 (empty)' },
]

const roleLegend = [
  { label: 'Sample', className: 'bg-blue-300' },
  { label: 'Positive control', className: 'bg-emerald-400' },
  { label: 'Negative control', className: 'bg-orange-400' },
]

describe('PlateMap SCI-005 extensions', () => {
  it('renders a role legend when roleLegend is provided', () => {
    render(
      <PlateMap
        wells={roleWells}
        roleLegend={roleLegend}
        ariaLabel="Test plate"
      />,
    )
    expect(screen.getByText('Sample')).toBeTruthy()
    expect(screen.getByText('Positive control')).toBeTruthy()
    expect(screen.getByText('Negative control')).toBeTruthy()
  })

  it('renders displayLabel inside well cells', () => {
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    expect(screen.getByRole('button', { name: 'A1 Sample' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'A2 Positive control' }),
    ).toBeTruthy()
  })

  it('distinguishes missing wells from empty wells', () => {
    render(
      <PlateMap wells={roleWells} rows={8} cols={12} ariaLabel="Test plate" />,
    )
    // B2 is in the wells array but has no value → empty
    expect(screen.getByRole('button', { name: 'B2 (empty)' })).toBeTruthy()
    // A3 is not in the wells array → also empty (no value)
    expect(screen.getByRole('button', { name: 'A3 (empty)' })).toBeTruthy()
  })

  it('selects a well by well code on click', async () => {
    const onSelectWellCode = vi.fn()
    const user = userEvent.setup()
    render(
      <PlateMap
        wells={roleWells}
        onSelectWellCode={onSelectWellCode}
        ariaLabel="Test plate"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'A1 Sample' }))
    expect(onSelectWellCode).toHaveBeenCalledWith('A1')
  })

  it('reports well code for empty cells on click', async () => {
    const onSelectWellCode = vi.fn()
    const user = userEvent.setup()
    render(
      <PlateMap
        wells={roleWells}
        onSelectWellCode={onSelectWellCode}
        ariaLabel="Test plate"
      />,
    )
    // Click an unassigned cell (A3)
    await user.click(screen.getByRole('button', { name: 'A3 (empty)' }))
    expect(onSelectWellCode).toHaveBeenCalledWith('A3')
  })

  it('marks the selected well by well code with aria-selected', () => {
    render(
      <PlateMap
        wells={roleWells}
        selectedWellCode="A2"
        ariaLabel="Test plate"
      />,
    )
    const cells = screen.getAllByRole('gridcell')
    const selected = cells.find(
      (c) => c.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toBeTruthy()
    expect(selected?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'A2 Positive control',
    )
  })

  it('moves focus right on ArrowRight', async () => {
    const user = userEvent.setup()
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    a1.focus()
    expect(document.activeElement).toBe(a1)
    await user.keyboard('{ArrowRight}')
    const a2 = screen.getByRole('button', { name: 'A2 Positive control' })
    expect(document.activeElement).toBe(a2)
  })

  it('moves focus down on ArrowDown', async () => {
    const user = userEvent.setup()
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    a1.focus()
    await user.keyboard('{ArrowDown}')
    const b1 = screen.getByRole('button', { name: 'B1 Negative control' })
    expect(document.activeElement).toBe(b1)
  })

  it('moves focus left on ArrowLeft and stops at edge', async () => {
    const user = userEvent.setup()
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    const a2 = screen.getByRole('button', { name: 'A2 Positive control' })
    a2.focus()
    await user.keyboard('{ArrowLeft}')
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    expect(document.activeElement).toBe(a1)
    // ArrowLeft at edge stays
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(a1)
  })

  it('moves focus up on ArrowUp and stops at edge', async () => {
    const user = userEvent.setup()
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    const b1 = screen.getByRole('button', { name: 'B1 Negative control' })
    b1.focus()
    await user.keyboard('{ArrowUp}')
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    expect(document.activeElement).toBe(a1)
    // ArrowUp at edge stays
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(a1)
  })

  it('moves to first column on Home', async () => {
    const user = userEvent.setup()
    render(<PlateMap wells={roleWells} ariaLabel="Test plate" />)
    const a2 = screen.getByRole('button', { name: 'A2 Positive control' })
    a2.focus()
    await user.keyboard('{Home}')
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    expect(document.activeElement).toBe(a1)
  })

  it('moves to last column on End', async () => {
    const user = userEvent.setup()
    render(
      <PlateMap wells={roleWells} rows={2} cols={2} ariaLabel="Test plate" />,
    )
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    a1.focus()
    await user.keyboard('{End}')
    const a2 = screen.getByRole('button', { name: 'A2 Positive control' })
    expect(document.activeElement).toBe(a2)
  })

  it('moves to first cell on Ctrl+Home', async () => {
    const user = userEvent.setup()
    render(
      <PlateMap wells={roleWells} rows={2} cols={2} ariaLabel="Test plate" />,
    )
    const b2 = screen.getByRole('button', { name: 'B2 (empty)' })
    b2.focus()
    await user.keyboard('{Control>}{Home}{/Control}')
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    expect(document.activeElement).toBe(a1)
  })

  it('moves to last cell on Ctrl+End', async () => {
    const user = userEvent.setup()
    render(
      <PlateMap wells={roleWells} rows={2} cols={2} ariaLabel="Test plate" />,
    )
    const a1 = screen.getByRole('button', { name: 'A1 Sample' })
    a1.focus()
    await user.keyboard('{Control>}{End}{/Control}')
    const b2 = screen.getByRole('button', { name: 'B2 (empty)' })
    expect(document.activeElement).toBe(b2)
  })

  it('disables all well buttons in read-only mode', () => {
    render(<PlateMap wells={roleWells} readOnly ariaLabel="Read-only plate" />)
    const buttons = screen.getAllByRole('button')
    for (const btn of buttons) {
      expect(btn.hasAttribute('disabled')).toBe(true)
    }
  })

  it('does not call onSelectWellCode in read-only mode', async () => {
    const onSelectWellCode = vi.fn()
    const user = userEvent.setup()
    render(
      <PlateMap
        wells={roleWells}
        readOnly
        onSelectWellCode={onSelectWellCode}
        ariaLabel="Read-only plate"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'A1 Sample' }))
    expect(onSelectWellCode).not.toHaveBeenCalled()
  })

  it('renders with custom rows and cols', () => {
    render(<PlateMap wells={[]} rows={4} cols={6} ariaLabel="Custom plate" />)
    // 4 rows: A, B, C, D
    expect(screen.getByRole('rowheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'D' })).toBeTruthy()
    // 6 columns: 1–6
    expect(screen.getByRole('columnheader', { name: '6' })).toBeTruthy()
  })
})

describe('PlateMap VIEW-02 selectable read-only', () => {
  it('reports selection while read-only when selectable', async () => {
    const onSelectWellCode = vi.fn()
    const user = userEvent.setup()
    render(
      <PlateMap
        wells={roleWells}
        readOnly
        selectable
        onSelectWellCode={onSelectWellCode}
        ariaLabel="Selectable plate"
      />,
    )
    // Selection is enabled: buttons stay interactive but nothing edits.
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.hasAttribute('disabled')).toBe(false)
    }
    await user.click(screen.getByRole('button', { name: 'A1 Sample' }))
    expect(onSelectWellCode).toHaveBeenCalledWith('A1')
    // Empty cells report their code too, so hosts can show context.
    await user.click(screen.getByRole('button', { name: 'C1 (empty)' }))
    expect(onSelectWellCode).toHaveBeenCalledWith('C1')
  })
})

describe('PlateMap VIEW-02 row-band windowing', () => {
  function renderLargePlate(
    props: Partial<ComponentProps<typeof PlateMap>> = {},
  ) {
    return render(
      <PlateMap
        wells={[]}
        rows={32}
        cols={48}
        ariaLabel="1536-well plate"
        {...props}
      />,
    )
  }

  it('windows 1536-cell grids by 8-row bands', () => {
    const { container } = renderLargePlate()
    // First band only: rows A–H mount, later rows do not.
    expect(screen.getByText(/Rows A–H of AF/)).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'H' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'I' })).toBeNull()
    // One band mounts: 8 × 48 wells instead of 1536.
    expect(container.querySelectorAll('button[data-cell]')).toHaveLength(
      8 * 48,
    )
  })

  it('pages between row bands', async () => {
    const user = userEvent.setup()
    renderLargePlate()
    await user.click(screen.getByRole('button', { name: 'Next row band' }))
    expect(screen.getByText(/Rows I–P of AF/)).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'I' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'A' })).toBeNull()
    await user.click(
      screen.getByRole('button', { name: 'Previous row band' }),
    )
    expect(screen.getByText(/Rows A–H of AF/)).toBeTruthy()
  })

  it('does not window small plates or when disabled', () => {
    render(
      <PlateMap wells={roleWells} rows={8} cols={12} ariaLabel="96-well" />,
    )
    expect(screen.queryByRole('button', { name: 'Next row band' })).toBeNull()
    cleanup()
    const { container } = renderLargePlate({ windowed: false })
    expect(screen.queryByRole('button', { name: 'Next row band' })).toBeNull()
    expect(container.querySelectorAll('button[data-cell]')).toHaveLength(
      32 * 48,
    )
  })

  it('jumps to the selected well band', () => {
    renderLargePlate({ selectedWellCode: 'AF48' })
    expect(screen.getByText(/Rows Y–AF of AF/)).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'AF' })).toBeTruthy()
  })

  it('selects wells inside a window by code', async () => {
    const onSelectWellCode = vi.fn()
    const user = userEvent.setup()
    renderLargePlate({
      selectedWellCode: 'B2',
      onSelectWellCode,
      selectable: true,
      readOnly: true,
    })
    await user.click(screen.getByRole('button', { name: 'B2 (empty)' }))
    expect(onSelectWellCode).toHaveBeenCalledWith('B2')
  })
})
