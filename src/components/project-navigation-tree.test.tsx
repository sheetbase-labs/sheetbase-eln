import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectNavigationTree } from './project-navigation-tree'
import type {
  NotebookRecord,
  Project,
  ProjectFolder,
} from '#/lib/notebook-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value)
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

afterEach(cleanup)

const project: Project = {
  id: 'project-id',
  key: 'PRJ-01',
  title: 'Stability programme',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
}

const folders: ProjectFolder[] = [
  {
    id: 'assays-id',
    projectId: project.id,
    parentId: null,
    identifier: 'F-01',
    name: 'Assays',
  },
  {
    id: 'results-id',
    projectId: project.id,
    parentId: 'assays-id',
    identifier: 'F-02',
    name: 'Results',
  },
]

function record(
  id: string,
  title: string,
  kind: string,
  folderId: string | null,
): NotebookRecord {
  return {
    id,
    projectId: project.id,
    folderId,
    kind,
    identifier: id,
    title,
    status: 'draft',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user-id',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  }
}

describe('ProjectNavigationTree', () => {
  it('renders the canonical project, folder, and object hierarchy', () => {
    render(
      <ProjectNavigationTree
        project={project}
        folders={folders}
        records={[
          record('experiment-id', 'Stability run', 'experiment', 'results-id'),
          record('sample-id', 'Reference sample', 'sample', null),
          record('report-id', 'Orphaned report', 'report', 'missing-folder'),
        ]}
        activeRecordId="experiment-id"
      />,
    )

    const contents = screen.getByRole('list', {
      name: 'Stability programme contents',
    })
    expect(within(contents).getByText('Assays')).toBeTruthy()
    expect(within(contents).getByText('Results')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Stability run' }).getAttribute('href'),
    ).toBe('/records/experiment-id')
    expect(
      screen
        .getByRole('link', { name: 'Reference sample' })
        .getAttribute('href'),
    ).toBe('/samples/sample-id')
    expect(
      screen
        .getByRole('link', { name: 'Orphaned report' })
        .getAttribute('href'),
    ).toBe('/records/report-id')
  })

  it('marks the active stable object destination as current', () => {
    render(
      <ProjectNavigationTree
        project={project}
        folders={[]}
        records={[record('record-id', 'Active record', 'report', null)]}
        activeRecordId="record-id"
      />,
    )
    expect(
      screen
        .getByRole('link', { name: 'Active record' })
        .getAttribute('aria-current'),
    ).toBe('page')
  })
})
