import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CreateReagentDialog } from './create-reagent-dialog'

afterEach(cleanup)

function setup(
  projects = [{ id: 'project-1', key: 'stability', title: 'Stability study' }],
) {
  const onCreate = vi.fn()
  render(
    <CreateReagentDialog
      open
      onOpenChange={vi.fn()}
      projects={projects}
      projectsLoading={false}
      pending={false}
      error={null}
      modelFields={[]}
      onCreate={onCreate}
    />,
  )
  return { user: userEvent.setup(), onCreate }
}

describe('CreateReagentDialog', () => {
  it('starts with the name focused and submits from the keyboard with one project', async () => {
    const { user, onCreate } = setup()
    expect(document.activeElement).toBe(screen.getByLabelText('Reagent name'))
    await user.type(screen.getByLabelText('Reagent name'), ' PBS{Enter}')
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        title: 'PBS',
        properties: expect.objectContaining({ quantity: '', unit: '' }),
      }),
    )
  })

  it('requires a unit for entered quantity, preserving decimal stock', async () => {
    const { user, onCreate } = setup()
    await user.type(screen.getByLabelText('Reagent name'), 'PBS')
    await user.type(screen.getByLabelText('Initial quantity'), '0.25')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create reagent',
      }).disabled,
    ).toBe(true)
    expect(screen.getByText(/Add a unit for this quantity/)).toBeTruthy()
    await user.type(screen.getByLabelText('Unit'), 'mL')
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Create reagent' }),
    )
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ quantity: '0.25', unit: 'mL' }),
      }),
    )
  })

  it('blocks negative starting stock before a mutation', async () => {
    const { user, onCreate } = setup()
    await user.type(screen.getByLabelText('Reagent name'), 'PBS')
    await user.type(screen.getByLabelText('Initial quantity'), '-2')
    await user.type(screen.getByLabelText('Unit'), 'mL')
    expect(screen.getByText('Enter a quantity of zero or more.')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create reagent',
      }).disabled,
    ).toBe(true)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('requires an explicit project when there is a choice', async () => {
    const { user, onCreate } = setup([
      { id: 'p1', key: 'a', title: 'Study A' },
      { id: 'p2', key: 'b', title: 'Study B' },
    ])
    await user.type(screen.getByLabelText('Reagent name'), 'PBS')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create reagent',
      }).disabled,
    ).toBe(true)
    await user.selectOptions(screen.getByLabelText('Project'), 'p2')
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Create reagent' }),
    )
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2' }),
    )
  })

  it('explains the prerequisite when no projects exist', () => {
    setup([])
    expect(screen.getByRole('status').textContent).toContain(
      'Create a project before adding reagents.',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create reagent',
      }).disabled,
    ).toBe(true)
  })
})
