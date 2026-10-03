import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SearchPalette } from './search-palette'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import { createGlobalShortcuts } from '#/lib/global-shortcuts'

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: vi.fn(async () => []),
    rpc: vi.fn(async () => []),
  },
}))

// `mod` is ⌘ on macOS, Ctrl elsewhere; pin the platform so the ⌘K binding is
// exercised deterministically.
beforeAll(() => {
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** The palette plus a trigger, mirroring how the shell opens it. */
function Harness({ onPalette }: { onPalette?: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <QueryClientProvider client={client()}>
      <ShortcutProvider
        definitions={createGlobalShortcuts({
          openPalette: () => {
            onPalette?.()
            setOpen(true)
          },
          openHelp: vi.fn(),
          toggleRail: vi.fn(),
          navigate: vi.fn(),
          destinations: [],
        })}
      >
        <button type="button" onClick={() => setOpen(true)}>
          Open search
        </button>
        <SearchPalette open={open} onOpenChange={setOpen} />
      </ShortcutProvider>
    </QueryClientProvider>
  )
}

describe('SearchPalette frame (SHELL-03.4)', () => {
  it('returns focus to the opener when it closes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open search' })
    await user.click(trigger)
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    await waitFor(() => expect(document.activeElement).toBe(input))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('is opened by the single ⌘K registry binding', async () => {
    const user = userEvent.setup()
    const onPalette = vi.fn()
    render(<Harness onPalette={onPalette} />)
    await user.keyboard('{Meta>}k{/Meta}')
    expect(onPalette).toHaveBeenCalledOnce()
    expect(
      await screen.findByPlaceholderText(
        'Search experiments, samples, datasets',
      ),
    ).toBeTruthy()
  })

  it('suppresses shortcuts while typing in the palette input', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    await user.click(input)
    await user.keyboard('g')
    await user.keyboard('h')
    // The palette is still open and no navigation fired: the registry ignored
    // the keystrokes because the focused target is a text field.
    expect(input).toBe(document.activeElement)
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})
