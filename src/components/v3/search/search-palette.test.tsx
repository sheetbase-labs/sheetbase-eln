import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { SearchPalette } from './search-palette'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import { createGlobalShortcuts } from '#/lib/global-shortcuts'

const mocks = vi.hoisted(() => {
  // The palette's project scope comes from the projects list; the search RPC is
  // mocked per test.
  const projects = [
    { id: 'project-a', title: 'Process Development' },
    { id: 'project-b', title: 'Analytics' },
  ]
  return {
    rpc: vi.fn(async (_name: string, _args?: unknown): Promise<unknown> => []),
    list: vi.fn(async (resource: string): Promise<unknown[]> => {
      if (resource === 'projects') return projects
      return []
    }),
  }
})

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: mocks.list,
    rpc: mocks.rpc,
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

describe('SearchPalette scope and suggestion (R5-SHELL-04)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async () => [])
  })

  async function openPalette() {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    return { user, input }
  }

  it('offers a corrected identifier when a query finds nothing', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'search_did_you_mean')
        return [
          {
            id: 'rec-1',
            kind: 'sample',
            identifier: 'SMP-2249',
            title: 'Virus stock A',
            similarity: 0.8,
          },
        ]
      return []
    })
    const { user, input } = await openPalette()
    await user.type(input, 'SMP-224')
    // The empty state names the correction with its type, sourced from the
    // canonical did-you-mean boundary.
    expect(
      await screen.findByText('Did you mean', { exact: false }),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'SMP-2249' })).toBeTruthy()
    expect(screen.getByText('Virus stock A · Sample')).toBeTruthy()
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_did_you_mean',
      expect.objectContaining({ p_query: 'SMP-224' }),
    )
  })

  it('asks the boundary for archived work only when Include archived is on', async () => {
    const { user, input } = await openPalette()
    await user.type(input, 'archived query')
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'search',
        expect.objectContaining({ p_include_archived: false }),
      ),
    )
    // The header toggle (first "Include archived" control) flips the scope.
    await user.click(
      screen.getAllByRole('button', { name: 'Include archived' })[0],
    )
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'search',
        expect.objectContaining({ p_include_archived: true }),
      ),
    )
  })
})

/** A search row for a project record, in the wire shape the RPC returns. */
const RECORD_ROW = {
  result_type: 'record',
  record_id: 'rec-1',
  kind: 'experiment',
  identifier: 'EXP-0142',
  title: 'Plate reader run',
  status: 'approved',
  project_id: 'project-a',
  archived: false,
  created_by_user_id: 'user-1',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
  matched_context: 'plate reader run',
  matched_field: 'title',
  rank: 0.5,
  deep_link: '/records/rec-1',
  total_count: 1,
}

/** A workspace-level template: it carries no project, so a project scope drops it. */
const WORKSPACE_TEMPLATE_ROW = {
  ...RECORD_ROW,
  result_type: 'template',
  record_id: 'tpl-1',
  kind: 'protocol_template',
  identifier: 'PT-0001',
  title: 'Cell culture protocol',
  project_id: null,
  deep_link: '/templates?protocol=tpl-1',
}

/** A sheet row: `api.search` fills identifier with the sheet's own id. */
const SHEET_ROW = {
  ...RECORD_ROW,
  result_type: 'sheet',
  record_id: '67d5c8d3-129b-44e8-bcbc-a1018b0d8041',
  kind: 'sheet_instance',
  identifier: '67d5c8d3-129b-44e8-bcbc-a1018b0d8041',
  title: 'Clarification working sheet',
  rank: 0.61,
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

describe('SearchPalette result labels and ranking (SRCH-02)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async () => [])
  })

  async function openPalette() {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    return { user, input }
  }

  it('opens the highlighted result in a new tab on ⌘↵ and leaves the page alone', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'search' ? [RECORD_ROW] : [],
    )
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const { user, input } = await openPalette()
      await user.type(input, 'plate')
      await screen.findByText('EXP-0142')

      await user.keyboard('{Meta>}{Enter}{/Meta}')

      expect(open).toHaveBeenCalledWith(
        `${window.location.origin}/records/rec-1`,
        '_blank',
        'noopener,noreferrer',
      )
      // The shortcut resolves in a new tab, so the palette stays where it is.
      expect(screen.queryByRole('dialog')).toBeTruthy()
    } finally {
      open.mockRestore()
    }
  })

  it('leads a sheet row with its name, not with the id the RPC returns', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'search' ? [SHEET_ROW] : [],
    )
    const { user, input } = await openPalette()
    await user.type(input, 'clarification')

    await screen.findByText('Sheet and dataset rows')
    const results = within(screen.getByRole('listbox', { name: 'Results' }))
    const option = results.getAllByRole('option')[0]
    expect(option.textContent).toContain('Clarification working sheet')
    expect(option.textContent).not.toMatch(UUID_RE)
    expect(screen.queryByText(SHEET_ROW.identifier)).toBeNull()
  })

  it('shows the matched snippet as text, without headline markup or its own id', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'search'
        ? [
            {
              ...SHEET_ROW,
              matched_context:
                '<b>Clarification</b> working sheet 67d5c8d3-129b-44e8-bcbc-a1018b0d8041',
            },
          ]
        : [],
    )
    const { user, input } = await openPalette()
    await user.type(input, 'clarification')

    await screen.findByText('Sheet and dataset rows')
    const results = within(screen.getByRole('listbox', { name: 'Results' }))
    const row = results.getAllByRole('option')[0]
    expect(row.textContent).not.toContain('<b>')
    expect(row.textContent).not.toContain('</b>')
    expect(row.textContent).not.toMatch(UUID_RE)
    // The matched term is still emphasised, as the results page renders it.
    const emphasis = row.querySelector('mark')
    expect(emphasis?.textContent).toBe('Clarification')
  })

  it('puts the closest match above the section that would otherwise lead', async () => {
    // The sheet is the higher canonical section but a weaker hit; ⌘K must offer
    // the record the query matched best first.
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'search'
        ? [
            { ...RECORD_ROW, rank: 0.9, title: 'Clarification run, screening' },
            SHEET_ROW,
          ]
        : [],
    )
    const { user, input } = await openPalette()
    await user.type(input, 'clarification')

    await screen.findByText('Sheet and dataset rows')
    const results = within(screen.getByRole('listbox', { name: 'Results' }))
    const options = results.getAllByRole('option')
    expect(options[0].textContent).toContain('EXP-0142')
    expect(options[1].textContent).toContain('Clarification working sheet')
    // Both rows are still grouped: the section order followed relevance.
    const headers = results
      .getAllByRole('presentation')
      .map((h) => h.textContent)
    expect(headers[0]).toContain('Records')
  })
})

describe('SearchPalette failure, progress and scope (R5-SHELL-04)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async () => [])
  })

  async function openPalette() {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    return { user, input }
  }

  it('says a search is running instead of showing an empty list', async () => {
    mocks.rpc.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return []
    })
    const { user, input } = await openPalette()
    await user.type(input, 'plate')

    expect(await screen.findByText('Searching…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull())
  })

  it('says the search failed and retries it', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('search unavailable'))
    const { user, input } = await openPalette()
    await user.type(input, 'plate')

    expect(await screen.findByText('Search could not run')).toBeTruthy()
    // A failed search is not a miss, so it never reads as one.
    expect(screen.queryByText(/No matches for/)).toBeNull()

    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'search') return [RECORD_ROW]
      return []
    })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('EXP-0142')).toBeTruthy()
  })

  it('names the project scope as the reason for no matches', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'search') return [WORKSPACE_TEMPLATE_ROW]
      return []
    })
    const { user, input } = await openPalette()
    // No page or create command is named like the query, so only the scope
    // stands between the person and a match.
    await user.type(input, 'PT-0001')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Search scope' }),
      'project-a',
    )

    // The scope, not the query, removed the only match: the palette says so
    // and offers the way out of it.
    expect(
      await screen.findByText('No matches in Process Development'),
    ).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Search all projects' }),
    )
    expect(await screen.findByText('PT-0001')).toBeTruthy()
  })
})

describe('SearchPalette combobox wiring (QA3-palette-2)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async () => [])
  })

  it('only points aria-controls at a listbox that is in the document', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )

    mocks.rpc.mockRejectedValueOnce(new Error('search unavailable'))
    await user.type(input, 'plate')
    await screen.findByText('Search could not run')
    expect(input.getAttribute('aria-controls')).toBeNull()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()

    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'search' ? [RECORD_ROW] : [],
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('EXP-0142')
    const id = input.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id as string)).toBeTruthy()
  })
})

describe('SearchPalette commands (Go to and New)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockImplementation(async () => [])
  })

  it('lists places to go and things to create before anything is typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    expect(await screen.findByRole('option', { name: /^Inbox/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /^New experiment/ })).toBeTruthy()
    expect(mocks.rpc).not.toHaveBeenCalledWith('search', expect.anything())
  })

  it('finds a page by name next to the search results', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open search' }))
    const input = await screen.findByPlaceholderText(
      'Search experiments, samples, datasets',
    )
    await user.type(input, 'pipelines')
    expect(
      await screen.findByRole('option', { name: /^Pipelines/ }),
    ).toBeTruthy()
  })
})
