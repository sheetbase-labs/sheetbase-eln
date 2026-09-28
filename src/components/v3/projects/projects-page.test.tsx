import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectsPage } from './projects-page'
import type { ProjectRow } from './types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

afterEach(cleanup)

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

function renderPage(projects: ProjectRow[]) {
  return render(
    <ProjectsPage
      projects={projects}
      me="Gareth P."
      search={{}}
      setSearch={() => {}}
      onCreate={() => {}}
    />,
  )
}

describe('ProjectsPage', () => {
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
    // Archived project hidden by the default filter.
    expect(screen.queryByText('Old project')).toBeNull()
    // Tabs carry counts.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('shows the empty state with no projects', () => {
    renderPage([])
    expect(screen.getByText('No projects yet')).toBeTruthy()
  })
})
