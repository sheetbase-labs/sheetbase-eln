import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { SearchableSelect } from './searchable-select'

afterEach(cleanup)

function Harness({ onPick }: { onPick: (value: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <SearchableSelect
      noun="event"
      aria-label="When"
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onPick(next)
      }}
    >
      <option value="">Any event</option>
      <optgroup label="Samples">
        <option value="sample.received">A sample is received</option>
        <option value="sample.moved">A sample is moved</option>
      </optgroup>
      <optgroup label="Bookings">
        {['made', 'cancelled'].map((what) => (
          <option key={what} value={`booking.${what}`}>
            A booking is {what}
          </option>
        ))}
      </optgroup>
    </SearchableSelect>
  )
}

describe('SearchableSelect', () => {
  it('lists the options under their group headings and chooses one', async () => {
    const user = userEvent.setup()
    const picked: string[] = []

    render(<Harness onPick={(value) => picked.push(value)} />)
    await user.click(screen.getByRole('button', { name: 'When' }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Samples')).toBeTruthy()
    expect(within(dialog).getByText('Bookings')).toBeTruthy()
    expect(
      within(dialog).getByRole('option', { name: 'A booking is cancelled' }),
    ).toBeTruthy()

    await user.click(
      within(dialog).getByRole('option', { name: 'A sample is moved' }),
    )
    expect(picked).toEqual(['sample.moved'])
    expect(screen.getByRole('button', { name: 'When' }).textContent).toContain(
      'A sample is moved',
    )
  })

  it('searches the list and turns the empty option into a way to choose nothing', async () => {
    const user = userEvent.setup()
    const picked: string[] = []

    render(<Harness onPick={(value) => picked.push(value)} />)
    expect(screen.getByRole('button', { name: 'When' }).textContent).toContain(
      'Any event',
    )

    await user.click(screen.getByRole('button', { name: 'When' }))
    await user.keyboard('booking')

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).queryByRole('option', { name: /sample/ })).toBeNull()
    await user.click(
      within(dialog).getByRole('option', { name: 'A booking is made' }),
    )
    expect(picked).toEqual(['booking.made'])

    await user.click(screen.getByRole('button', { name: 'When' }))
    await user.click(await screen.findByRole('option', { name: 'Any event' }))
    expect(picked).toEqual(['booking.made', ''])
  })
})
