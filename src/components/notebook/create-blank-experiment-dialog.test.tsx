import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBlankExperiment } from '#/lib/notebook-create'
import { CreateBlankExperimentDialog } from './create-blank-experiment-dialog'

vi.mock('#/lib/notebook-create', () => ({
  createBlankExperiment: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('CreateBlankExperimentDialog', () => {
  it('autofocuses the title input and uses a short Create label', () => {
    renderDialog(
      <CreateBlankExperimentDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
      />,
    )
    const title = screen.getByLabelText('Experiment title')
    expect(document.activeElement).toBe(title)
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Create blank Notebook' }),
    ).toBeNull()
    expect(
      screen.getByText(/You can add Sheets and files in the Notebook/),
    ).toBeTruthy()
    expect(screen.queryByText(/Templates/i)).toBeNull()
  })

  it('offers Start writing when a project is already pinned', async () => {
    const user = userEvent.setup()
    vi.mocked(createBlankExperiment).mockResolvedValue({
      id: 'exp-1',
      projectId: 'project-1',
    } as never)
    renderDialog(
      <CreateBlankExperimentDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Start writing' }))
    await waitFor(() => expect(createBlankExperiment).toHaveBeenCalledTimes(1))
    expect(createBlankExperiment).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'project-1',
      title: '',
    })
  })

  it('hides Start writing when the project is not pinned', () => {
    renderDialog(
      <CreateBlankExperimentDialog
        open
        onOpenChange={vi.fn()}
        projects={[{ id: 'project-1', title: 'Alpha' } as never]}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Start writing' })).toBeNull()
  })
})
