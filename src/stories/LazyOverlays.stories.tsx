import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import {
  LazySearchPalette,
  LazyShortcutsDialog,
} from '#/components/shell/lazy-overlays'
import { Button } from '#/components/ui/button'
import { PANE_SHORTCUTS, SCOPED_SHORTCUTS } from '#/lib/shortcut-scopes'
import {
  StubDataClient,
  screenQueryClient,
  screenRoutes,
} from './screen-stories'
import type { DataClientStub } from './screen-stories'

/**
 * The search palette and the shortcuts dialog are closed on almost every page
 * view, so the shell mounts their code only when one is first opened. These
 * stories open each from a button and show that the overlay arrives with the
 * click and stays mounted after. The palette's search is answered by an empty
 * stub, so it shows its own empty state.
 */
// SAFETY: this story opens the palette and answers no search; the empty
// answers are the story's claim about every call the palette makes.
const EMPTY_STUB: DataClientStub = {
  rpc: async <T,>() => ({}) as T,
  list: async <T,>() => [] as T[],
}

const meta = {
  title: 'Shell/Lazy overlays',
  parameters: {
    layout: 'fullscreen',
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const client = screenQueryClient({ data: [] })

export const ShortcutsDialog: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false)

    return (
      <ShortcutProvider definitions={[...PANE_SHORTCUTS, ...SCOPED_SHORTCUTS]}>
        <div className="p-6">
          <Button onClick={() => setOpen(true)}>Open shortcuts</Button>
        </div>
        <LazyShortcutsDialog open={open} onOpenChange={setOpen} />
      </ShortcutProvider>
    )
  },
}

export const SearchPalette: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false)

    return (
      <QueryClientProvider client={client}>
        <StubDataClient stub={EMPTY_STUB}>
          <div className="p-6">
            <Button onClick={() => setOpen(true)}>Open search</Button>
          </div>
          <LazySearchPalette open={open} onOpenChange={setOpen} />
        </StubDataClient>
      </QueryClientProvider>
    )
  },
}
