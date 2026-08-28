/**
 * BlockPicker component tests (ELN-005). The picker is the only insertion
 * affordance on the canvas; it must expose familiar labels and call
 * onInsert with the right type when an item is chosen.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockPicker, BLOCK_PICKER_OPTIONS } from './block-picker'

afterEach(() => cleanup())

describe('BlockPicker', () => {
  it('exposes the editable block types with familiar labels', () => {
    const types = BLOCK_PICKER_OPTIONS.map((o) => o.type)
    expect(types).toEqual([
      'rich_text',
      'checklist',
      'linked_record',
      'sheet',
      'sheet_shared',
      'protocol_reference',
      'materials',
      'file',
      'chart',
      'analysis',
      'plate_map',
      'pipeline_output',
    ])
    expect(BLOCK_PICKER_OPTIONS.map((o) => o.label)).toEqual([
      'Text',
      'Checklist',
      'Linked record',
      'Sheet',
      'Link existing Sheet',
      'Protocol',
      'Materials',
      'File',
      'Chart',
      'Analysis',
      'Plate map',
      'Pipeline output',
    ])
    expect(types).not.toContain('heading')
    expect(
      BLOCK_PICKER_OPTIONS.find((o) => o.type === 'linked_record')?.description,
    ).toBe('A reference to another experiment, Dataset, sample or reagent.')
  })

  it('groups insert options into writing, structure and evidence', async () => {
    const user = userEvent.setup()
    render(<BlockPicker onInsert={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Add block/ }))
    expect(screen.getByText('Writing')).toBeTruthy()
    expect(screen.getByText('Sheets and references')).toBeTruthy()
    expect(screen.getByText('Files and figures')).toBeTruthy()
  })

  it('calls onInsert with the chosen type', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    render(<BlockPicker onInsert={onInsert} />)
    await user.click(screen.getByRole('button', { name: /Add block/ }))
    await user.click(screen.getByRole('menuitem', { name: /Checklist/ }))
    expect(onInsert).toHaveBeenCalledWith('checklist')
  })

  it('renders a disabled trigger when disabled', () => {
    render(<BlockPicker onInsert={vi.fn()} disabled />)
    const trigger = screen.getByRole('button', { name: /Add block/ })
    expect(trigger.hasAttribute('disabled')).toBe(true)
  })
})
