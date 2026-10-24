import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'

import {
  MODEL_DESCRIPTION_MAX,
  MODEL_NAME_MAX,
  ModelCreateDialog,
  describeModelCreateError,
  modelCreateErrors,
} from './model-create-dialog'
import type { ModelCreateInput } from './model-create-dialog'

afterEach(cleanup)

describe('modelCreateErrors', () => {
  it('requires the key and the name the RPC requires', () => {
    expect(modelCreateErrors({ key: '', name: '', description: '' })).toEqual({
      key: 'Key is required.',
      name: 'Name is required.',
    })
  })

  it('enforces the RPC key contract (^[a-z][a-z0-9_]{0,59}$)', () => {
    const bad = [
      'Cell bank',
      'cell-bank',
      '1cell_bank',
      '_cell_bank',
      'CELL',
      'a'.repeat(61),
    ]
    for (const key of bad) {
      expect(
        modelCreateErrors({ key, name: 'Cell bank', description: '' }).key,
      ).toBeDefined()
    }
    for (const key of ['a', 'cell_bank_reading', 'a'.repeat(60)]) {
      expect(
        modelCreateErrors({ key, name: 'Cell bank', description: '' }).key,
      ).toBeUndefined()
    }
  })

  it('bounds the name at 200 and the description at 2000, as the RPC does', () => {
    const longName = modelCreateErrors({
      key: 'cell_bank',
      name: 'x'.repeat(MODEL_NAME_MAX + 1),
      description: '',
    })
    expect(longName.name).toBeDefined()
    expect(
      modelCreateErrors({
        key: 'cell_bank',
        name: 'x'.repeat(MODEL_NAME_MAX),
        description: '',
      }).name,
    ).toBeUndefined()

    const longDescription = modelCreateErrors({
      key: 'cell_bank',
      name: 'Cell bank',
      description: 'x'.repeat(MODEL_DESCRIPTION_MAX + 1),
    })
    expect(longDescription.description).toBeDefined()
    expect(
      modelCreateErrors({
        key: 'cell_bank',
        name: 'Cell bank',
        description: 'x'.repeat(MODEL_DESCRIPTION_MAX),
      }).description,
    ).toBeUndefined()
  })

  it('accepts a well-formed draft model', () => {
    expect(
      modelCreateErrors({
        key: 'cell_bank_reading',
        name: 'Cell bank reading',
        description: 'Viability and count at thaw.',
      }),
    ).toEqual({})
  })
})

describe('describeModelCreateError', () => {
  it('states the capability refusal the server gave (42501)', () => {
    expect(
      describeModelCreateError(
        new DataClientError('42501', 'capability required: schema.edit', 403),
      ),
    ).toBe('You don’t have permission to create models in this workspace.')
  })

  it('names a duplicate key (23505) rather than echoing the constraint', () => {
    expect(
      describeModelCreateError(
        new DataClientError(
          '23505',
          'duplicate key value violates unique constraint "uq_dataset_schema_definitions_workspace_key"',
          409,
        ),
      ),
    ).toBe('A model with that key already exists in this workspace.')
  })

  it('passes an unclassified refusal through, and is silent with no error', () => {
    expect(
      describeModelCreateError(
        new DataClientError(
          'SB071',
          'invalid Dataset Schema Definition metadata',
          400,
        ),
      ),
    ).toBe('invalid Dataset Schema Definition metadata')
    expect(describeModelCreateError(null)).toBeNull()
  })
})

function renderDialog(onCreate: (input: ModelCreateInput) => void = vi.fn()) {
  render(
    <ModelCreateDialog
      open
      onOpenChange={() => undefined}
      onCreate={onCreate}
      creating={false}
      error={null}
    />,
  )
  return onCreate
}

describe('ModelCreateDialog', () => {
  it('says what is wrong with the key as it is typed', async () => {
    renderDialog()
    await userEvent.type(
      screen.getByPlaceholderText('cell_bank_reading'),
      'Cell bank',
    )
    expect(
      screen.getByText(
        'Use lower-case letters, digits and _, starting with a letter (max 60 characters).',
      ),
    ).toBeTruthy()
  })

  it('refuses an empty form, naming every missing field, and creates nothing', async () => {
    const onCreate = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(screen.getByText('Key is required.')).toBeTruthy()
    expect(screen.getByText('Name is required.')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('creates the model from the trimmed values', async () => {
    const onCreate = renderDialog()
    await userEvent.type(
      screen.getByPlaceholderText('cell_bank_reading'),
      '  cell_bank_reading',
    )
    await userEvent.type(
      screen.getByPlaceholderText('e.g. Cell bank reading'),
      ' Cell bank reading ',
    )
    await userEvent.type(
      screen.getByRole('textbox', { name: /Description/ }),
      'Viability at thaw. ',
    )
    const form = document.getElementById('new-model-form') as HTMLFormElement
    fireEvent.submit(form)
    expect(onCreate).toHaveBeenCalledWith({
      kind: 'dataset',
      key: 'cell_bank_reading',
      name: 'Cell bank reading',
      description: 'Viability at thaw.',
    })
  })

  it('creates a distinct Record Model only with an explicit identifier prefix', async () => {
    const onCreate = renderDialog()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'record')
    await userEvent.type(
      screen.getByPlaceholderText('cell_bank_reading'),
      'cell_bank',
    )
    await userEvent.type(
      screen.getByPlaceholderText('e.g. Cell bank reading'),
      'Cell bank',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByText(/Use 1–8 upper-case letters/)).toBeTruthy()
    await userEvent.type(screen.getByPlaceholderText('CB'), 'cb')
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(onCreate).toHaveBeenCalledWith({
      kind: 'record',
      identifierPrefix: 'CB',
      key: 'cell_bank',
      name: 'Cell bank',
      description: null,
    })
  })

  it('states the refusal the server returned', () => {
    render(
      <ModelCreateDialog
        open
        onOpenChange={() => undefined}
        onCreate={vi.fn()}
        creating={false}
        error="A model with that key already exists in this workspace."
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'A model with that key already exists in this workspace.',
    )
  })
})
