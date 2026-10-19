import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SaveAsTemplateDialog } from './save-as-template-dialog'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/lib/experiment-to-template', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveExperimentAsTemplate: (...args: unknown[]) => mocks.save(...args),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign((...args: unknown[]) => mocks.toast(...args), {
    error: vi.fn(),
  }),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
})

const experiment = {
  id: '00000000-0000-4000-8000-000000000001',
  workspace_id: '00000000-0000-4000-8000-000000000002',
  identifier: 'EXP-0142',
  title: 'Harvest clarification',
}

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SaveAsTemplateDialog
        open
        onOpenChange={() => undefined}
        experiment={experiment}
      />
    </QueryClientProvider>,
  )
}

describe('SaveAsTemplateDialog', () => {
  it('saves with a key made from the name, says what was left out and opens the template', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue({
      template: { id: 'tpl-1', name: 'Harvest clarification' },
      version: {},
      leftOut: ['2 charts'],
    })
    renderDialog()
    await user.click(
      await screen.findByRole('button', { name: 'Save as template' }),
    )
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          experimentId: experiment.id,
          workspaceId: experiment.workspace_id,
          key: 'harvest_clarification',
          name: 'Harvest clarification',
        }),
      ),
    )
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/templates/$templateId',
        params: { templateId: 'tpl-1' },
      }),
    )
    expect(mocks.toast.mock.calls[0]?.[1]).toMatchObject({
      description: expect.stringContaining('Not carried over: 2 charts'),
    })
  })

  it('will not save with a key the server would refuse', async () => {
    const user = userEvent.setup()
    renderDialog()
    const key = await screen.findByDisplayValue('harvest_clarification')
    await user.clear(key)
    await user.type(key, 'Bad Key')
    const button = screen.getByRole('button', { name: 'Save as template' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
