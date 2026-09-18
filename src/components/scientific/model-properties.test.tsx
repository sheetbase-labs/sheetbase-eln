import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelProperties } from './model-properties'
import type { ModelFieldDefinition } from '#/lib/model-fields'

afterEach(cleanup)

const definition: ModelFieldDefinition = {
  id: 'field-1',
  modelKey: 'report',
  fieldName: 'programme',
  label: 'Programme',
  description: null,
  displayOrder: 1,
  logicalType: 'text',
  nullable: true,
  defaultValue: null,
  unit: null,
  validation: {},
  lifecycle: 'active',
  options: [],
}

describe('ModelProperties', () => {
  it('renders system and workspace properties in one layout with system locks', () => {
    render(
      <ModelProperties
        lockedProperties={[
          { key: 'identifier', label: 'Identifier', value: 'RPT-2026-0001' },
        ]}
        definitions={[definition]}
        values={{ programme: 'Oncology' }}
      />,
    )

    expect(screen.getByText('Identifier')).toBeTruthy()
    expect(screen.getByText('RPT-2026-0001')).toBeTruthy()
    expect(screen.getByText('Programme')).toBeTruthy()
    expect(screen.getByText('Oncology')).toBeTruthy()
    expect(screen.getByLabelText('Locked system property')).toBeTruthy()
  })

  it('edits only workspace properties and submits typed values', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <ModelProperties
        lockedProperties={[
          { key: 'identifier', label: 'Identifier', value: 'RPT-2026-0001' },
        ]}
        definitions={[definition]}
        values={{ programme: 'Oncology' }}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Identifier')).toBeTruthy()
    expect(screen.getByText('RPT-2026-0001')).toBeTruthy()
    expect(screen.queryByLabelText('Identifier')).toBeNull()
    const input = screen.getByRole('textbox', { name: 'Programme' })
    await user.clear(input)
    await user.type(input, 'Neurology')
    await user.click(screen.getByRole('button', { name: 'Save properties' }))
    expect(onSave).toHaveBeenCalledWith({ programme: 'Neurology' })
  })

  it('disables workspace editing when the record is locked', () => {
    render(
      <ModelProperties
        lockedProperties={[]}
        definitions={[definition]}
        values={{}}
        recordLocked
        onSave={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByLabelText('Locked workspace property')).toBeTruthy()
  })
})
