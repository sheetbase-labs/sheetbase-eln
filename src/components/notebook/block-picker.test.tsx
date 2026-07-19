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
      'heading',
      'rich_text',
      'checklist',
      'linked_record',
      'sheet',
    ])
    expect(BLOCK_PICKER_OPTIONS.map((o) => o.label)).toEqual([
      'Heading',
      'Text',
      'Checklist',
      'Linked record',
      'Sheet',
    ])
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
