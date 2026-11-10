import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProjectNavigationTree } from '#/components/project-navigation-tree'
import type {
  NotebookRecord,
  Project,
  ProjectFolder,
} from '#/lib/notebook-data'
import { screenRoutes } from './screen-stories'

/**
 * The project's contents as a tree: folders, nested folders and the records in
 * them, with the open record highlighted. Records outside any folder sit at the
 * root, and names sort alphabetically.
 */
const PROJECT: Project = {
  id: 'p1',
  key: 'TB02',
  title: 'TB-02 stability',
  status: 'active',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: null,
  archivedAt: null,
}

const FOLDERS: ProjectFolder[] = [
  {
    id: 'f1',
    projectId: 'p1',
    parentId: null,
    identifier: 'F-1',
    name: 'Week 1',
  },
  {
    id: 'f2',
    projectId: 'p1',
    parentId: 'f1',
    identifier: 'F-2',
    name: 'Day 3',
  },
  {
    id: 'f3',
    projectId: 'p1',
    parentId: null,
    identifier: 'F-3',
    name: 'Week 2',
  },
]

function record(
  id: string,
  title: string,
  folderId: string | null,
): NotebookRecord {
  return {
    id,
    projectId: 'p1',
    folderId,
    kind: 'experiment',
    identifier: id.toUpperCase(),
    title,
    status: 'in_progress',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user-1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  }
}

const RECORDS = [
  record('e1', 'Virus stability at 25 °C', 'f1'),
  record('e2', 'Titre by plaque assay', 'f2'),
  record('e3', 'Buffer exchange optimisation', 'f3'),
  record('e4', 'Scoping notes', null),
]

const meta = {
  title: 'Project/Navigation tree',
  component: ProjectNavigationTree,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/', ['/projects/$projectId', '/experiments/$id']),
        path: '/',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
  args: { project: PROJECT, folders: FOLDERS, records: RECORDS },
} satisfies Meta<typeof ProjectNavigationTree>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A record is open, so its row is highlighted instead of the project's. */
export const ActiveRecord: Story = { args: { activeRecordId: 'e2' } }

export const Empty: Story = { args: { folders: [], records: [] } }
