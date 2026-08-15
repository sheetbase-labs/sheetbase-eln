import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelFieldInput } from './model-field-input'
import type { ModelFieldDefinition } from '#/lib/model-fields'

afterEach(cleanup)

function field(
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: 'field-1',
    modelKey: 'sample',
    fieldName: 'concentration',
    label: 'Concentration',
    description: null,
    displayOrder: 1,
    logicalType: 'text',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

describe('ModelFieldInput', () => {
  it('exposes a labelled boolean control and reports its checked state', async () => {
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({ logicalType: 'boolean', label: 'Approved' })}
        value={false}
        onChange={onChange}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Approved' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('offers active categories and preserves a selected retired category', async () => {
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'category',
          label: 'Material class',
          nullable: true,
          options: [
            {
              id: '1',
              key: 'active',
              label: 'Active',
              displayOrder: 1,
              lifecycle: 'active',
            },
            {
              id: '2',
              key: 'old',
              label: 'Retired choice',
              displayOrder: 2,
              lifecycle: 'retired',
            },
            {
              id: '3',
              key: 'hidden',
              label: 'Hidden choice',
              displayOrder: 3,
              lifecycle: 'retired',
            },
          ],
        })}
        value="old"
        onChange={onChange}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Material class' })
    expect(screen.getByRole('option', { name: 'Not set' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Retired choice' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Hidden choice' })).toBeNull()
    await userEvent.selectOptions(select, 'active')
    expect(onChange).toHaveBeenCalledWith('active')
  })

  it('configures a required decimal input and exposes its description', async () => {
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'decimal',
          nullable: false,
          description: 'Enter the measured value.',
        })}
        value="1.5"
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('spinbutton', { name: 'Concentration' })
    expect(input.getAttribute('required')).not.toBeNull()
    expect(input.getAttribute('step')).toBe('any')
    expect(screen.getByText('Enter the measured value.')).toBeTruthy()
    fireEvent.change(input, { target: { value: '2.75' } })
    expect(onChange).toHaveBeenLastCalledWith('2.75')
  })

  it('renders a Record reference as a text input rather than an invalid HTML type', () => {
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value=""
        onChange={vi.fn()}
      />,
    )

    expect(
      screen
        .getByRole('textbox', { name: 'Source sample' })
        .getAttribute('type'),
    ).toBe('text')
    expect(
      screen.getByText(
        'Persists the Record UUID. Record ID and Name are display only.',
      ),
    ).toBeTruthy()
  })

  it('accepts a Record UUID and refuses a generated Record ID as identity', async () => {
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value=""
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Source sample' })
    fireEvent.change(input, { target: { value: 'SMP-2026-0001' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Record reference identity is the Record UUID, not the Record ID or Name.',
      ),
    ).toBeTruthy()
    fireEvent.change(input, {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    expect(onChange).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    )
  })
})
