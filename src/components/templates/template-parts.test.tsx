import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TemplatePartsSection } from './template-parts'

afterEach(cleanup)

const parts = [
  { id: 'p1', title: 'Seed', dayOffset: 0 },
  { id: 'p2', title: 'Dose', dayOffset: 2 },
]

describe('TemplatePartsSection', () => {
  it('lists the parts with their day and no controls when reading', () => {
    render(
      <TemplatePartsSection
        parts={parts}
        placements={[]}
        editable={false}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Seed')).toBeTruthy()
    expect(screen.getByText('Dose')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add part' })).toBeNull()
  })

  it('adds a part on the day after the last, and removes one', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TemplatePartsSection
        parts={parts}
        placements={[]}
        editable
        onChange={onChange}
      />,
    )
    await user.type(screen.getByLabelText(/Part title/), 'Wash')
    await user.click(screen.getByRole('button', { name: 'Add part' }))
    expect(onChange).toHaveBeenLastCalledWith([
      ...parts,
      expect.objectContaining({ title: 'Wash', dayOffset: 3 }),
    ])
    await user.click(screen.getByRole('button', { name: 'Remove Seed' }))
    expect(onChange).toHaveBeenLastCalledWith([parts[1]])
  })
})
