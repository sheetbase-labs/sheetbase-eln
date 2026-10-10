import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BLOCK_PICKER_GROUPS, BLOCK_PICKER_OPTIONS } from './block-picker'
import type { BlockPickerOption } from './block-picker'
import {
  SlashCommandMenu,
  slashCommandFilterCount,
  slashCommandFilteredOptions,
} from './slash-command-menu'

afterEach(() => cleanup())

// EXP-04.3 — the Insert block menu follows `canvas/NbEditing.dc.html`: the
// labels and descriptions below are the canvas's, verbatim.

describe('block catalogue — Insert block design', () => {
  // The key may genuinely be absent, so the lookup is optional: a missing option should
  // fail the assertion rather than throw while the test is being read.
  const byType: Record<string, BlockPickerOption | undefined> =
    Object.fromEntries(BLOCK_PICKER_OPTIONS.map((opt) => [opt.type, opt]))

  it('uses the canvas label and description for each block the design names', () => {
    expect(byType.sheet?.label).toBe('Sheet')
    expect(byType.sheet?.description).toBe('Grid backed by a model')
    expect(byType.chart?.label).toBe('Chart')
    expect(byType.chart?.description).toBe('From a sheet or dataset')
    expect(byType.linked_record?.label).toBe('Record reference')
    expect(byType.linked_record?.description).toBe('Sample, material, dataset…')
    expect(byType.rich_text?.label).toBe('Text')
    expect(byType.rich_text?.description).toBe('Paragraph')
    expect(byType.file?.label).toBe('File or image')
  })

  it('orders the named blocks as the canvas does, group by group', () => {
    const groupLabels = (group: string) =>
      BLOCK_PICKER_OPTIONS.filter((opt) => opt.group === group).map(
        (opt) => opt.label,
      )

    // The design opens on Sheet, so its group leads the menu…
    expect(BLOCK_PICKER_GROUPS.map((group) => group.id)).toEqual([
      'structure',
      'writing',
      'evidence',
    ])
    // …and within each group the design's "Sheet, Chart, Record reference,
    // Text, File or image" order holds (Chart sits with the other figures).
    expect(groupLabels('structure').slice(0, 2)).toEqual([
      'Sheet',
      'Record reference',
    ])
    expect(groupLabels('writing')[0]).toBe('Text')
    expect(groupLabels('evidence').slice(0, 2)).toEqual([
      'Chart',
      'File or image',
    ])
  })
})

describe('slashCommandFilteredOptions', () => {
  it('matches scientist aliases such as image, dataset and table', () => {
    expect(slashCommandFilteredOptions('image').map((opt) => opt.type)).toEqual(
      ['file'],
    )
    expect(
      slashCommandFilteredOptions('dataset').map((opt) => opt.type),
    ).toContain('linked_record')
    expect(slashCommandFilteredOptions('table').map((opt) => opt.type)).toEqual(
      ['sheet'],
    )
  })

  it('matches descriptions and keeps grouped option order', () => {
    expect(slashCommandFilterCount('')).toBeGreaterThan(0)
    expect(slashCommandFilteredOptions('heading')[0]?.type).toBe('rich_text')
  })
})

describe('SlashCommandMenu', () => {
  it('renders the design chrome and highlights the selected option', () => {
    render(<SlashCommandMenu query="" selectedIndex={0} onSelect={vi.fn()} />)

    expect(screen.getByRole('listbox', { name: 'Insert block' })).toBeTruthy()
    expect(screen.getByText('Insert block')).toBeTruthy()

    const options = screen.getAllByRole('option')
    // Index 0 is the design's default: Sheet.
    expect(options[0].textContent).toContain('Sheet')
    expect(options[0].textContent).toContain('Grid backed by a model')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(options[1].getAttribute('aria-selected')).toBe('false')
    expect(
      screen.getByText('↑ ↓ to move · Enter to insert · Esc to close'),
    ).toBeTruthy()
  })

  it('narrows the list as the query is typed', () => {
    render(
      <SlashCommandMenu query="table" selectedIndex={0} onSelect={vi.fn()} />,
    )

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('Grid backed by a model')
  })

  it('reports the highlighted block when it is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SlashCommandMenu query="chart" selectedIndex={0} onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('option', { name: /Chart/ }))
    expect(onSelect).toHaveBeenCalledWith('chart')
  })

  it('reports the hovered index so the parent can highlight it', async () => {
    const user = userEvent.setup()
    const onHoverIndex = vi.fn()
    render(
      <SlashCommandMenu
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onHoverIndex={onHoverIndex}
      />,
    )

    await user.hover(screen.getByRole('option', { name: /Checklist/ }))
    expect(onHoverIndex).toHaveBeenCalledWith(6)
  })

  it('says so instead of rendering options when nothing matches', () => {
    render(
      <SlashCommandMenu query="zzz" selectedIndex={0} onSelect={vi.fn()} />,
    )

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching block types')).toBeTruthy()
  })
})
