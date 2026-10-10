import { Link } from '@tanstack/react-router'
import { FileText, FolderOpen } from 'lucide-react'

import { Icon } from '#/components/icons'
import { recordDestination } from '#/lib/navigation'
import type {
  NotebookRecord,
  Project,
  ProjectFolder,
} from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

export function ProjectNavigationTree({
  project,
  folders,
  records,
  activeRecordId,
}: {
  project: Project
  folders: ProjectFolder[]
  records: NotebookRecord[]
  activeRecordId?: string
}) {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const rootFolders = folders
    .filter(
      (folder) => folder.parentId === null || !folderIds.has(folder.parentId),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  const rootRecords = records
    .filter((record) => !record.folderId || !folderIds.has(record.folderId))
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="text-sm">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        aria-current={activeRecordId ? undefined : 'page'}
        className={cn(
          'flex min-h-8 items-center gap-2 rounded-md px-2 font-medium text-sidebar-foreground no-underline hover:bg-sidebar-accent/60',
          !activeRecordId && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{project.title}</span>
      </Link>

      <ul
        aria-label={`${project.title} contents`}
        className="mt-0.5 space-y-0.5"
      >
        {rootFolders.map((folder) => (
          <FolderBranch
            key={folder.id}
            folder={folder}
            folders={folders}
            records={records}
            activeRecordId={activeRecordId}
            depth={0}
          />
        ))}
        {rootRecords.map((record) => (
          <RecordNode
            key={record.id}
            record={record}
            active={record.id === activeRecordId}
            depth={0}
          />
        ))}
      </ul>
    </div>
  )
}

function FolderBranch({
  folder,
  folders,
  records,
  activeRecordId,
  depth,
}: {
  folder: ProjectFolder
  folders: ProjectFolder[]
  records: NotebookRecord[]
  activeRecordId?: string
  depth: number
}) {
  const children = folders
    .filter((candidate) => candidate.parentId === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const folderRecords = records
    .filter((record) => record.folderId === folder.id)
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <li>
      <div
        className="flex min-h-8 items-center gap-2 px-2 text-xs font-medium text-muted-foreground"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <Icon name="folder" className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{folder.name}</span>
      </div>
      {children.length > 0 || folderRecords.length > 0 ? (
        <ul>
          {children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              folders={folders}
              records={records}
              activeRecordId={activeRecordId}
              depth={depth + 1}
            />
          ))}
          {folderRecords.map((record) => (
            <RecordNode
              key={record.id}
              record={record}
              active={record.id === activeRecordId}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function RecordNode({
  record,
  active,
  depth,
}: {
  record: NotebookRecord
  active: boolean
  depth: number
}) {
  return (
    <li>
      <Link
        to={recordDestination(record.kind, record.id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground no-underline hover:bg-sidebar-accent/60',
          active && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
        style={{ paddingLeft: `${depth * 12 + 32}px` }}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2">{record.title}</span>
      </Link>
    </li>
  )
}
