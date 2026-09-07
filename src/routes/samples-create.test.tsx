import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateSampleDialog } from './samples'

afterEach(cleanup)
const defaults = {
  open: true,
  onOpenChange: vi.fn(),
  projects: [{ id: 'project-1', key: 'study', title: 'Stability study' }],
  projectsLoading: false,
  pending: false,
  error: null,
  onCreate: vi.fn(),
  modelFields: [],
}

describe('sample creation', () => {
  it('retains scientific inputs after a failed save so the user can retry', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const view = render(
      <CreateSampleDialog {...defaults} onCreate={onCreate} />,
    )
    await user.type(screen.getByLabelText('Sample name'), 'Plasma pool')
    await user.type(screen.getByLabelText('Quantity'), '12.5')
    await user.type(screen.getByLabelText('Unit'), 'mL')
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Create sample' }),
    )
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        title: 'Plasma pool',
        properties: expect.objectContaining({
          quantity: '12.5',
          quantityUnit: 'mL',
        }),
      }),
    )
    view.rerender(
      <CreateSampleDialog
        {...defaults}
        onCreate={onCreate}
        error="Could not save. Try again."
      />,
    )
    expect(screen.getByLabelText<HTMLInputElement>('Sample name').value).toBe(
      'Plasma pool',
    )
    expect(screen.getByLabelText<HTMLInputElement>('Quantity').value).toBe(
      '12.5',
    )
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Create sample' }),
    )
    expect(onCreate).toHaveBeenCalledTimes(2)
  })

  it('prevents a negative stock quantity', async () => {
    const user = userEvent.setup()
    render(<CreateSampleDialog {...defaults} />)
    await user.type(screen.getByLabelText('Sample name'), 'Plasma pool')
    await user.type(screen.getByLabelText('Quantity'), '-1')
    expect(screen.getByRole('alert').textContent).toContain('zero or greater')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create sample',
      }).disabled,
    ).toBe(true)
  })

  it('explains a project loading error and offers retry', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(
      <CreateSampleDialog
        {...defaults}
        projects={[]}
        projectsError
        onRetryProjects={retry}
      />,
    )
    await user.click(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }),
    )
    expect(retry).toHaveBeenCalledOnce()
  })
})
