import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { choose } from '../../../../tests/unit/picker'
import {
  PickerMultiSelect,
  PickerSelect,
  filterPickerOptions,
} from './entity-picker'
import type { PickerOption } from './entity-picker'

afterEach(cleanup)

const options: PickerOption[] = [
  {
    id: 'p1',
    identifier: 'PRJ-001',
    label: 'Lentivector stability',
    facets: { stage: 'Discovery', lead: 'Priya' },
  },
  {
    id: 'p2',
    identifier: 'PRJ-002',
    label: 'AAV capsid screen',
    facets: { stage: 'Discovery', lead: 'Tom' },
  },
  {
    id: 'p3',
    identifier: 'PRJ-003',
    label: 'Plasmid yield',
    facets: { stage: 'Clinical', lead: 'Priya' },
  },
  {
    id: 'p4',
    label: 'Retired work',
    disabled: true,
    disabledReason: 'Archived',
  },
]

describe('filterPickerOptions', () => {
  it('matches every word of a query against identifier, name and facet values', () => {
    expect(
      filterPickerOptions(options, 'prj-002 aav', {}).map((o) => o.id),
    ).toEqual(['p2'])
    expect(
      filterPickerOptions(options, 'clinical', {}).map((o) => o.id),
    ).toEqual(['p3'])
  })

  it('ORs the values of one field and ANDs different fields', () => {
    const got = (active: Record<string, string[]>) =>
      filterPickerOptions(options, '', active).map((o) => o.id)
    expect(got({ stage: ['Discovery', 'Clinical'] })).toEqual([
      'p1',
      'p2',
      'p3',
    ])
    expect(got({ stage: ['Discovery'], lead: ['Priya'] })).toEqual(['p1'])
  })
})

function Single({ onChange = vi.fn() }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <label>
      Project
      <PickerSelect
        noun="project"
        value={value}
        onChange={(id) => {
          setValue(id)
          onChange(id)
        }}
        options={options}
        clearLabel="No project"
      />
    </label>
  )
}

describe('PickerSelect', () => {
  it('shows the chosen record on the field and offers a way to choose nothing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    const field = screen.getByRole('button', { name: /Project/ })
    expect(field.textContent).toBe('No project')
    await choose(user, 'Project', /Plasmid yield/)
    expect(onChange).toHaveBeenLastCalledWith('p3')
    expect(field.textContent).toContain('Plasmid yield')
    await choose(user, 'Project', /No project/)
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('narrows by search and by a stacked filter, and says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Single />)
    await user.click(screen.getByRole('button', { name: /Project/ }))
    const dialogs = await screen.findAllByRole('dialog')
    const picker = within(dialogs[dialogs.length - 1])

    await user.click(picker.getByRole('button', { name: 'Add a filter' }))
    await user.click(await screen.findByRole('button', { name: /Lead/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Priya/ }))
    await waitFor(() =>
      expect(picker.queryByRole('option', { name: /AAV capsid/ })).toBeNull(),
    )
    expect(picker.getByRole('option', { name: /Lentivector/ })).toBeTruthy()

    await user.type(picker.getByRole('combobox'), 'zzz')
    expect(await picker.findByText(/No projects match/)).toBeTruthy()
    await user.click(picker.getByRole('button', { name: 'Clear filters' }))
  })

  it('does not let an unavailable record be chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /Project/ }))
    const dialogs = await screen.findAllByRole('dialog')
    const row = within(dialogs[dialogs.length - 1]).getByRole('option', {
      name: /Retired work/,
    })
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.textContent).toContain('Archived')
    await user.click(row)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('searches on the server when given a search function', async () => {
    const user = userEvent.setup()
    const search = vi.fn(async (q: string) => ({
      options: options.filter((o) => o.label.toLowerCase().includes(q)),
      total: 3,
    }))
    render(
      <PickerSelect
        noun="project"
        value=""
        onChange={() => {}}
        search={search}
        aria-label="Project"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Project' }))
    await waitFor(() => expect(search).toHaveBeenCalledWith(''))
    const dialogs = await screen.findAllByRole('dialog')
    await user.type(
      within(dialogs[dialogs.length - 1]).getByRole('combobox'),
      'aav',
    )
    await waitFor(() => expect(search).toHaveBeenCalledWith('aav'))
  })
})

describe('PickerMultiSelect', () => {
  it('chooses several records at once and removes one from the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Multi() {
      const [values, setValues] = useState<string[]>(['p1'])
      return (
        <PickerMultiSelect
          noun="project"
          values={values}
          options={options}
          onChange={(ids) => {
            setValues(ids)
            onChange(ids)
          }}
          aria-label="Related projects"
        />
      )
    }
    render(<Multi />)
    await user.click(screen.getByRole('button', { name: 'Related projects' }))
    const dialogs = await screen.findAllByRole('dialog')
    const picker = within(dialogs[dialogs.length - 1])
    await user.click(await picker.findByRole('option', { name: /AAV capsid/ }))
    await user.click(picker.getByRole('option', { name: /Plasmid yield/ }))
    await user.click(picker.getByRole('button', { name: 'Add 3' }))
    expect(onChange).toHaveBeenLastCalledWith(['p1', 'p2', 'p3'])

    await user.click(
      screen.getByRole('button', { name: 'Remove AAV capsid screen' }),
    )
    expect(onChange).toHaveBeenLastCalledWith(['p1', 'p3'])
  })
})
