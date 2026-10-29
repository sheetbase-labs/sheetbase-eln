import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectsPage } from './projects-page'
import { WorkspaceNavigationContext } from '#/components/workspace/workspace-navigation'
import type { ProjectsSearch } from './projects-page'
import type { ProjectRow } from './types'
import type * as ProjectData from './project-data'
import type * as WorkspaceAccess from '#/lib/workspace-access'

const { dataClient, navigate } = vi.hoisted(() => ({
  navigate: vi.fn(),
  dataClient: {
    list: vi.fn<() => Promise<unknown[]>>(async () => []),
    rpc: vi.fn<() => Promise<unknown>>(async () => ({})),
  },
}))
vi.mock('./project-data', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectData>()),
  projectDataClient: dataClient,
}))

const { assignments } = vi.hoisted(() => ({
  assignments: vi.fn<() => Promise<unknown[]>>(async () => []),
}))
vi.mock('#/lib/workspace-access', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceAccess>()),
  fetchMyProjectAssignments: assignments,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    children,
    onClick,
  }: {
    to?: unknown
    children?: React.ReactNode
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick}>
      {children}
    </a>
  ),
}))

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast }))

afterEach(() => {
  cleanup()
  toast.mockClear()
  toast.error.mockClear()
})

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    uuid: '00000000-0000-4000-8000-000000000320',
    id: 'PRJ-0217',
    name: 'AAV9 process transfer',
    client: 'CL-017',
    modality: 'AAV9',
    stage: 'Tech transfer',
    lead: 'Gareth P.',
    experiments: 14,
    status: { tone: 'progress', label: 'In progress' },
    archived: false,
    updated: 100,
    ...overrides,
  }
}

function renderPage(
  projects: ProjectRow[],
  search: ProjectsSearch = {},
  meId?: string,
  canCreate = true,
  state: {
    loading?: boolean
    error?: string | null
    onRetry?: () => void
    onOpenProject?: (p: ProjectRow) => void
    openInWorkspace?: (
      href: string,
      options?: { beside?: boolean; title?: string },
    ) => void
  } = {},
  setSearch: (patch: Partial<ProjectsSearch>) => void = () => {},
) {
  // ProjectsPage reads project access through react-query, as the route does
  // inside the app's provider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceNavigationContext
        value={state.openInWorkspace ? { open: state.openInWorkspace } : null}
      >
        <ProjectsPage
          projects={projects}
          me="Gareth P."
          meId={meId}
          canCreate={canCreate}
          loading={state.loading}
          error={state.error ?? null}
          onRetry={state.onRetry}
          onOpenProject={state.onOpenProject}
          search={search}
          setSearch={setSearch}
          onCreate={() => {}}
        />
      </WorkspaceNavigationContext>
    </QueryClientProvider>,
  )
}

describe('ProjectsPage', () => {
  // The row used to only select a project for the quick-view panel, so clicking
  // a project did nothing on the desktop table (the mobile list and the panel's
  // own "Open project" both go to the project page). The row and the name now
  // open the project.
  it('opens the project when its row is clicked, and makes the name a link', () => {
    const opened: string[] = []
    renderPage([row()], {}, undefined, true, {
      onOpenProject: (p) => opened.push(p.id),
    })

    const name = screen.getByRole('link', { name: 'AAV9 process transfer' })
    expect(name.getAttribute('href')).toBe('/projects/$projectId')

    fireEvent.click(name.closest('tr')!)
    expect(opened).toEqual(['PRJ-0217'])
  })

  it('opens rows and name links in the pane, beside on Alt-click, and leaves modified links native', () => {
    const open = vi.fn()
    navigate.mockClear()
    renderPage([row()], {}, undefined, true, { openInWorkspace: open })
    const name = screen.getByRole('link', { name: 'AAV9 process transfer' })
    const href = '/projects/00000000-0000-4000-8000-000000000320'
    // A row or its Open button navigates this pane; the name link does so itself.
    fireEvent.click(name.closest('tr')!)
    fireEvent.click(
      screen.getByRole('button', { name: 'Open AAV9 process transfer' }),
    )
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenLastCalledWith({ href })
    expect(fireEvent.click(name)).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(fireEvent.click(name, { altKey: true })).toBe(false)
    expect(open).toHaveBeenCalledWith(href, {
      beside: true,
      title: 'AAV9 process transfer',
    })
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.click(name, { [modifier]: true })).toBe(true)
    }
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Project details')).toBeNull()
  })

  it('renders the design columns and tab counts', () => {
    renderPage([
      row(),
      row({
        id: 'PRJ-0214',
        name: 'LVV stability',
        status: { tone: 'review', label: 'In review' },
      }),
      row({ id: 'PRJ-0170', name: 'Old project', archived: true }),
    ])
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy()
    expect(screen.getAllByText('PRJ-0217').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CL-017').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tech transfer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Gareth P.').length).toBeGreaterThan(0)
    // Tabs carry counts.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('lists every project on the All tab, so All means all', () => {
    renderPage([
      row(),
      row({
        id: 'PRJ-0214',
        name: 'LVV stability',
        status: { tone: 'review', label: 'In review' },
      }),
      row({ id: 'PRJ-0170', name: 'Old project', archived: true }),
    ])
    // The archived project is a row on the default view, not hidden behind a
    // filter the person never set.
    expect(
      screen.getByRole('button', { name: 'Open Old project' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Remove filter: status isn’t Archived',
      }),
    ).toBeNull()
    expect(screen.getByText(/^3 projects$/)).toBeTruthy()
  })

  it('hides archived projects only while the stated filter is on', () => {
    renderPage(
      [row(), row({ id: 'PRJ-0170', name: 'Old project', archived: true })],
      { tab: 'inprogress', archived: 'exclude' },
    )
    expect(screen.queryByText('Old project')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'Remove filter: status isn’t Archived',
      }),
    ).toBeTruthy()
    expect(screen.getByText(/1 archived hidden by filter/)).toBeTruthy()
  })

  it('shows the empty state with no projects', () => {
    renderPage([])
    expect(screen.getByText('No projects yet')).toBeTruthy()
  })

  it('says access, not absence, when the person can view no project', async () => {
    // `my_project_permissions` returns no rows: the workspace may hold
    // projects, but this person can see none of them. Claiming "No projects
    // yet" here would be false, and counting the others would leak them.
    assignments.mockResolvedValueOnce([])
    renderPage([])
    expect(
      await screen.findByText('No projects you can access yet'),
    ).toBeTruthy()
    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(
      screen.getByText(/only the projects you have access to/),
    ).toBeTruthy()
    // Creating a project stays available (the page header and the empty state
    // both offer it).
    expect(
      screen.getAllByRole('button', { name: 'New project' }).length,
    ).toBeGreaterThan(0)
  })

  it('keeps the neutral copy while access is unknown', () => {
    // No permission rows recorded yet (or the read failed): the UI must not
    // assert a denial it cannot prove.
    assignments.mockImplementationOnce(() => new Promise(() => {}))
    renderPage([])
    expect(screen.getByText('No projects yet')).toBeTruthy()
  })

  it('the explicit Archived URL view includes archives but excludes active projects', () => {
    renderPage(
      [row(), row({ id: 'PRJ-0170', name: 'Old project', archived: true })],
      { tab: 'archived' },
    )
    expect(
      screen.getByRole('button', { name: 'Open Old project' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Open AAV9 process transfer',
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: 'Remove filter: status isn’t Archived',
      }),
    ).toBeNull()
  })

  it('Mine uses the lead identity, not duplicate display names, and fields come from URL state', () => {
    renderPage(
      [
        row({ leadUserId: 'me' }),
        row({
          id: 'PRJ-0214',
          name: 'Other Gareth project',
          leadUserId: 'other',
        }),
      ],
      { tab: 'mine', fields: 'stage,experiments' },
      'me',
    )
    expect(screen.queryByText('Other Gareth project')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Stage' })).toBeNull()
    expect(
      screen.queryByRole('columnheader', { name: 'Experiments' }),
    ).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeTruthy()
  })

  it('sorts by ID ascending, matching the label and the Name order', () => {
    renderPage(
      [
        row({ id: 'PRJ-0217' }),
        row({
          id: 'PRJ-0100',
          uuid: '00000000-0000-4000-8000-000000000100',
          name: 'Early project',
        }),
        row({
          id: 'PRJ-0320',
          uuid: '00000000-0000-4000-8000-000000000320',
          name: 'Late project',
        }),
      ],
      { sort: 'id' },
    )
    const table = screen.getByRole('table', { name: 'Projects' })
    const idCells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((tableRow) => within(tableRow).getAllByRole('cell')[0].textContent)
    expect(idCells).toEqual(['PRJ-0100', 'PRJ-0217', 'PRJ-0320'])
  })

  it('spans a group band across exactly the table columns', () => {
    renderPage([row(), row({ id: 'PRJ-0100', name: 'Second project' })], {
      group: 'stage',
    })
    const table = screen.getByRole('table', { name: 'Projects' })
    const columnCount = within(table).getAllByRole('columnheader').length
    const band = screen.getByText((_, element) => {
      return (
        element?.tagName === 'TD' && element.textContent === 'Tech transfer 2'
      )
    })
    expect(Number(band.getAttribute('colspan'))).toBe(columnCount)
  })

  it('does not assert a project count while the read is unresolved', () => {
    const resolved = renderPage([
      row(),
      row({
        id: 'PRJ-0100',
        uuid: '00000000-0000-4000-8000-000000000100',
        name: 'Second project',
      }),
    ])
    // Known: the count is stated (header badge and the "All" tab agree).
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    resolved.unmount()

    // Unresolved: a stalled read is not a project count of zero.
    const stalled = renderPage([], {}, undefined, true, { loading: true })
    expect(screen.getByText('Loading projects…')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
    stalled.unmount()

    // Failed: the count is unknown, so it is not stated either.
    renderPage([], {}, undefined, true, {
      error: 'The project list didn’t answer within 15 s.',
    })
    expect(screen.queryByText('0')).toBeNull()
  })

  it('states the read failure and offers a retry', () => {
    const onRetry = vi.fn()
    renderPage([], {}, undefined, true, {
      error: 'The project list didn’t answer within 15 s.',
      onRetry,
    })
    expect(screen.getByRole('alert').textContent).toMatch(
      /didn’t answer within 15 s/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('says why the header New project cannot be used', () => {
    const loading = renderPage([], {}, undefined, true, { loading: true })
    expect(
      screen.getByRole('button', { name: 'New project' }).getAttribute('title'),
    ).toMatch(/waiting for the project list to load/i)
    loading.unmount()

    renderPage([row()], {}, undefined, false)
    expect(
      screen.getByRole('button', { name: 'New project' }).getAttribute('title'),
    ).toMatch(/role can’t create projects/i)
  })

  it('disables the empty-state New project and says why when the role cannot create', () => {
    renderPage([], {}, undefined, false)
    const emptyState = screen.getByText('No projects yet').parentElement
    expect(emptyState).not.toBeNull()
    expect(
      within(emptyState as HTMLElement)
        .getByRole('button', { name: 'New project' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      within(emptyState as HTMLElement).getByText(/role can’t create projects/),
    ).toBeTruthy()
  })

  it('opens the create dialog from New project even when the search update never lands', () => {
    // The click's client navigation can be superseded while the page is still
    // loading: the URL ends up carrying ?new=true while the page's own search
    // never does, which used to leave the button looking dead. The intent is
    // recorded where the click happened, so the dialog opens either way.
    const setSearch = vi.fn()
    renderPage([row()], {}, undefined, true, {}, setSearch)

    fireEvent.click(screen.getByRole('button', { name: 'New project' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(setSearch).toHaveBeenCalledWith({ new: true })
  })

  it('opens the create dialog from the ?new=true URL the shell link carries', () => {
    const setSearch = vi.fn()
    renderPage([row()], { new: true }, undefined, true, {}, setSearch)

    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setSearch).toHaveBeenCalledWith({ new: undefined })
  })

  it('states why a create intent from the URL cannot open the dialog', () => {
    const setSearch = vi.fn()
    renderPage([row()], { new: true }, undefined, false, {}, setSearch)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/role can’t create projects/i),
      expect.objectContaining({
        description: expect.stringMatching(/ask an admin/i),
      }),
    )
    expect(setSearch).toHaveBeenCalledWith({ new: undefined })
  })

  it('archives the selected projects only after the confirmation', async () => {
    dataClient.list.mockResolvedValueOnce([{ role: 'owner' }])
    renderPage(
      [row(), row({ id: 'PRJ-0100', name: 'Second project' })],
      {},
      'me',
    )
    const boxes = await screen.findAllByRole('checkbox', {
      name: /^Select PRJ-/,
    })
    fireEvent.click(boxes[0])

    fireEvent.click(screen.getByRole('button', { name: 'Archive 1' }))
    // Destructive, so the RPC waits for the confirmation.
    expect(dataClient.rpc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Archive 1 project' }))
    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith('archive_project', {
        p_project_id: '00000000-0000-4000-8000-000000000320',
      }),
    )
  })
})

describe('projects header reflows at 400 % zoom (QA4-zoom-projects)', () => {
  // A 1440 px window at 400 % zoom leaves the project column 312 px wide. The
  // title row (title, count, "New project") and the phone tab row (three tabs
  // plus "More") are both wider than that on one line: "More" ended 18 px past
  // the viewport and the document scrolled sideways (WCAG 1.4.10). Both rows
  // wrap instead.
  it('wraps the title row and the phone tab row', () => {
    renderPage([row()])

    const titleRow = screen.getByText('Projects', {
      selector: 'h1',
    }).parentElement
    expect(titleRow).not.toBeNull()
    expect(titleRow!.className).toContain('max-md:flex-wrap')

    const tabRows = screen
      .getAllByRole('navigation', { name: 'Project views' })
      .map((nav) => nav.parentElement)
    expect(tabRows).toHaveLength(2)
    // The phone row (the one carrying the "More" menu) wraps; the desktop row
    // scrolls inside its own strip.
    const phoneRow = tabRows.find((el) => el!.className.includes('lg:hidden'))
    expect(phoneRow).toBeDefined()
    expect(phoneRow!.className).toContain('flex-wrap')
  })
})
