import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Inspector, InspectorSection, PageHeader } from './layout'

afterEach(cleanup)

it('opens and dismisses an inspector from an external toolbar trigger', async () => {
  function Workbench() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open settings</button>
        <Inspector label="Settings" open={open} onOpenChange={setOpen}>
          <p>Axis controls</p>
        </Inspector>
      </>
    )
  }
  render(<Workbench />)
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  expect(dialog.textContent).toContain('Axis controls')
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

describe('Layout headings', () => {
  it('renders an inspector section at H2, so an inspector-only page never skips a level', () => {
    render(
      <InspectorSection title="Details">
        <p>body</p>
      </InspectorSection>,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Details' }),
    ).toBeTruthy()
  })

  it('names a page at H1 and puts a nested header one level below it', () => {
    render(
      <>
        <PageHeader title="Client portal" />
        <PageHeader title="ACME-01" titleLevel={2} />
      </>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Client portal' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 2, name: 'ACME-01' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
