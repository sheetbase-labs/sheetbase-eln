import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelFieldInput } from './model-field-input'
import type { ModelFieldDefinition } from '#/lib/model-fields'

afterEach(cleanup)
// jsdom does not implement ResizeObserver; cmdk reads it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

  it('renders a Record reference picker rather than a raw UUID input', () => {
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

    expect(screen.queryByRole('textbox', { name: 'Source sample' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Select record' })).toBeTruthy()
    expect(
      screen.getByText(
        'Selection persists the Record UUID. Record ID and Name are display only.',
      ),
    ).toBeTruthy()
  })

  it('refuses a generated Record ID as identity without losing the stored value', () => {
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value="SMP-2026-0001"
        onChange={onChange}
      />,
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Record reference identity is the Record UUID, not the Record ID or Name.',
      ),
    ).toBeTruthy()
  })

  it('resolves a linked Record to its human label', async () => {
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value="11111111-1111-4111-8111-111111111111"
        onChange={vi.fn()}
        resolveReferenceSnapshot={async () => ({
          recordId: '11111111-1111-4111-8111-111111111111',
          modelKey: 'sample',
          kind: 'sample',
          identifier: 'SMP-2026-0042',
          title: 'Liver section',
          archived: false,
          deleted: false,
        })}
      />,
    )
    expect(
      await screen.findByText('SMP-2026-0042 · Liver section'),
    ).toBeTruthy()
  })

  it('reports a missing Record honestly instead of inventing a label', async () => {
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value="11111111-1111-4111-8111-111111111111"
        onChange={vi.fn()}
        resolveReferenceSnapshot={async () => null}
      />,
    )
    expect(
      await screen.findByText(/not found or not visible in this workspace/),
    ).toBeTruthy()
  })

  it('selects a Record through the picker and persists the stable UUID', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ModelFieldInput
        definition={field({
          logicalType: 'reference',
          label: 'Source batch',
          validation: { targetModelKey: 'batch' },
        })}
        value=""
        onChange={onChange}
        searchReferenceRecords={async () => [
          {
            id: '11111111-1111-4111-8111-111111111111',
            kind: 'batch',
            identifier: 'BAT-2026-0007',
            title: 'Batch seven',
            status: 'active',
            archived: false,
          },
        ]}
        resolveReferenceSnapshot={async () => null}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Select record' }))
    await user.click(await screen.findByText('Batch seven'))
    expect(onChange).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    )
  })
})

describe('ModelFieldInput with MODEL-03 rules', () => {
  const rules = [
    {
      id: 'rule-1',
      sourceModelKey: 'experiment',
      linkType: 'sample',
      targetModelKey: 'sample',
      minLinks: 0,
      maxLinks: null,
      label: null,
    },
  ]

  it('hides the picker with an honest message when the target is disallowed', () => {
    render(
      <ModelFieldInput
        definition={field({
          modelKey: 'experiment',
          logicalType: 'reference',
          label: 'Reagent lot',
          validation: { targetModelKey: 'material' },
        })}
        value=""
        onChange={vi.fn()}
        relationshipRules={rules}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Select record' })).toBeNull()
    expect(
      screen.getByText(/experiment does not accept material references/i),
    ).toBeTruthy()
  })

  it('keeps offering the picker when the target is declared', () => {
    render(
      <ModelFieldInput
        definition={field({
          modelKey: 'experiment',
          logicalType: 'reference',
          label: 'Source sample',
          validation: { targetModelKey: 'sample' },
        })}
        value=""
        onChange={vi.fn()}
        relationshipRules={rules}
      />,
    )
    expect(screen.getByRole('button', { name: 'Select record' })).toBeTruthy()
  })

  it('stays unrestricted without rules', () => {
    render(
      <ModelFieldInput
        definition={field({
          modelKey: 'experiment',
          logicalType: 'reference',
          label: 'Reagent lot',
          validation: { targetModelKey: 'material' },
        })}
        value=""
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Select record' })).toBeTruthy()
  })
})
