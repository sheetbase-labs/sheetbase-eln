import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { RecordModelEditDialog } from './record-model-edit-dialog'

const mocks = vi.hoisted(() => ({
  fetchValues: vi.fn(),
  update: vi.fn(),
}))

vi.mock('#/lib/model-fields', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRecordModelFieldValues: (...a: unknown[]) => mocks.fetchValues(...a),
  updateRecordModelFieldValues: (...a: unknown[]) => mocks.update(...a),
}))
vi.mock('./models-data', () => ({
  modelFieldInputErrors: () => ({}),
  modelFieldErrorMessage: (code: string) => code,
  recordModelDetailQueryKeys: {
    record: (id: string) => ['record', id],
    timeline: (id: string) => ['timeline', id],
  },
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/components/scientific/model-field-input', () => ({
  ModelFieldInput: ({
    definition,
    value,
    onChange,
  }: {
    definition: ModelFieldDefinition
    value: string
    onChange: (v: string) => void
  }) => (
    <input
      aria-label={definition.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

const note = {
  id: 'f1',
  modelKey: 'cell_bank',
  fieldName: 'note',
  label: 'Note',
  description: null,
  logicalType: 'text',
  nullable: true,
  defaultValue: null,
  options: [],
} as unknown as ModelFieldDefinition

function mount() {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordModelEditDialog
        open
        onOpenChange={onOpenChange}
        recordId="rec-1"
        fields={[note]}
        stored={{ note: 'old' }}
        client={{} as never}
      />
    </QueryClientProvider>,
  )
  return onOpenChange
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RecordModelEditDialog', () => {
  it('keeps Save off until something changes, then sends only the change', async () => {
    const user = userEvent.setup()
    mocks.fetchValues.mockResolvedValue({
      customFields: { note: 'old' },
      metadataVersion: 3,
      locked: false,
    })
    mocks.update.mockResolvedValue({})
    const onOpenChange = mount()
    const save = screen.getByRole('button', { name: 'Save details' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    await user.clear(screen.getByLabelText('Note'))
    await user.type(screen.getByLabelText('Note'), 'new')
    await user.click(save)

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({}, 'rec-1', 3, {
        note: 'new',
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('says why a locked record cannot be edited', async () => {
    const user = userEvent.setup()
    mocks.fetchValues.mockResolvedValue({
      customFields: {},
      metadataVersion: 3,
      locked: true,
    })
    mount()
    await user.type(screen.getByLabelText('Note'), '!')
    await user.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/record is locked/)).toBeTruthy()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
