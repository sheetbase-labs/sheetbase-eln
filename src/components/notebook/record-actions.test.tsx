import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { afterEach, expect, it, vi } from 'vitest'

import {
  RecordActionsMenu,
  RecordActionsProvider,
  useOfferedRecordActions,
  useOfferRecordActions,
} from './record-actions'

afterEach(cleanup)

function Offer({ onSelect }: { onSelect: () => void }) {
  useOfferRecordActions(
    [{ id: 'edit', label: 'Edit', icon: 'edit', onSelect }],
    true,
  )

  return null
}

function Menu() {
  const actions = useOfferedRecordActions()

  return actions.map((action) => (
    <button key={action.id} onClick={action.onSelect}>
      {action.label}
    </button>
  ))
}

it('runs the latest committed action without requiring its label to change', () => {
  const first = vi.fn()
  const latest = vi.fn()

  const ui = (onSelect: () => void) => (
    <RecordActionsProvider>
      <Offer onSelect={onSelect} />
      <Menu />
    </RecordActionsProvider>
  )

  const { rerender } = render(ui(first))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(first).toHaveBeenCalledTimes(1)

  rerender(ui(latest))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(latest).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledTimes(1)
})

it('renders the download action as a named native anchor through the real menu', async () => {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RouterContextProvider router={router}>
      <RecordActionsMenu
        actions={[
          {
            id: 'download',
            label: 'Download notebook',
            icon: 'download',
            href: '/api/files/file-1/download',
          },
        ]}
      />
    </RouterContextProvider>,
  )
  await userEvent.click(screen.getByRole('button'))

  const item = await screen.findByRole('menuitem', {
    name: 'Download notebook',
  })

  expect(item.tagName).toBe('A')
  expect(item.getAttribute('href')).toBe('/api/files/file-1/download')
  expect(item.textContent).toBe('Download notebook')
})
