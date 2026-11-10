import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TemplatePartsSection } from './template-parts'
import type { TemplatePart } from './template-parts'

afterEach(cleanup)

const parts = [
  { id: 'p1', title: 'Seed', dayOffset: 0 },
  { id: 'p2', title: 'Dose', dayOffset: 2 },
]

function EditableParts({
  onChange,
}: {
  onChange: (next: TemplatePart[]) => void
}) {
  const [value, setValue] = useState<TemplatePart[]>([
    { ...parts[0], opensWhen: [{ kind: 'part_done', partId: '' }] },
    {
      ...parts[1],
      opensWhen: [
        { kind: 'field_set', field: 'reviewer', label: '  Legacy label  ' },
      ],
      gateMode: 'block',
    },
  ])

  return (
    <TemplatePartsSection
      parts={value}
      placements={[]}
      editable
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

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

  it('preserves legacy gate values on save, cancels edits, refuses an incomplete condition and removes the rule', async () => {
    const client = new QueryClient()
    client.setQueryData(['extensions', 'points'], [])
    const changed = vi.fn<(next: TemplatePart[]) => void>()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <EditableParts onChange={changed} />
      </QueryClientProvider>,
    )

    try {
      await user.click(
        screen.getByRole('button', { name: 'Change when Dose opens' }),
      )
      await user.click(await screen.findByRole('button', { name: 'Save gate' }))
      expect(changed.mock.calls[0]?.[0][1]).toMatchObject({
        opensWhen: [
          { kind: 'field_set', field: 'reviewer', label: '  Legacy label  ' },
        ],
        gateMode: 'block',
      })
      await user.click(
        screen.getByRole('button', { name: 'Change when Dose opens' }),
      )
      await user.selectOptions(
        await screen.findByLabelText('Field'),
        'assignee',
      )
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(changed).toHaveBeenCalledTimes(1)
      await user.click(
        screen.getByRole('button', { name: 'Change when Seed opens' }),
      )
      await screen.findByLabelText('Part')
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Save gate' })
          .disabled,
      ).toBe(true)
      expect(changed).toHaveBeenCalledTimes(1)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await user.click(
        screen.getByRole('button', { name: 'Change when Dose opens' }),
      )
      await user.selectOptions(screen.getByLabelText('Condition'), 'field_set')
      await user.selectOptions(screen.getByLabelText('Field'), 'assignee')
      await user.click(screen.getByRole('button', { name: 'Save gate' }))
      expect(changed.mock.calls[1]?.[0][1].opensWhen).toEqual([
        { kind: 'field_set', field: 'assignee', label: 'Assignee' },
      ])
      await user.click(
        screen.getByRole('button', { name: 'Change when Dose opens' }),
      )
      await user.click(
        await screen.findByRole('button', { name: 'Remove gate' }),
      )
      expect(changed.mock.calls[2]?.[0][1]).toMatchObject({
        opensWhen: undefined,
        gateMode: undefined,
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally {
      cleanup()
      client.clear()
    }
  })
})
