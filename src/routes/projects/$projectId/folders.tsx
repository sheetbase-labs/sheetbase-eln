import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Icon } from '#/components/v3/icons'
import { Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import { Select } from '#/components/v3/ui/select'
import {
  createProjectFolder,
  fetchProjectFolders,
  fetchProjectMembers,
  moveRecordsToFolder,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import type { ProjectFolder } from '#/components/v3/projects/project-data'
import { statusLabel, statusTone } from '../$projectId'
import {
  fetchRecordsForProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'

const UNFILED = '__unfiled__'

/** UI port (roadmap-4/ui-app3): the project Folders tab. Folders only
 * organise; moving a record keeps its ID, links, history and access. */
export const Route = createFileRoute('/projects/$projectId/folders')({
  component: ProjectFolders,
})

function ProjectFolders() {
  const { projectId } = Route.useParams()
  const { project } = useProjectSummary(projectId)
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const foldersQuery = useQuery({
    queryKey: ['project-folders', projectId],
    queryFn: () => fetchProjectFolders(projectId),
  })
  const recordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
  })
  // Same query the project frame reads, so the members are already cached.
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => fetchProjectMembers(projectId),
    enabled: Boolean(project),
  })
  const folders = foldersQuery.data ?? []
  const records = recordsQuery.data ?? []
  const [current, setCurrent] = useState<string>(UNFILED)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)

  useEffect(() => setSelected(new Set()), [current])

  const currentFolder = folders.find((f) => f.id === current) ?? null
  const shown = records.filter((r) =>
    current === UNFILED ? !r.folderId : r.folderId === current,
  )
  const count = (id: string) =>
    id === UNFILED
      ? records.filter((r) => !r.folderId).length
      : records.filter((r) => r.folderId === id).length

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['project-folders', projectId],
    })
    void queryClient.invalidateQueries({
      queryKey: notebookQueryKeys.records(projectId),
    })
  }

  const addFolder = useMutation({
    mutationFn: (input: { name: string; parentId: string | null }) =>
      createProjectFolder(projectId, input.name, input.parentId),
    onSuccess: (folder: ProjectFolder) => {
      invalidate()
      setCurrent(folder.id)
      toast(`Folder “${folder.name}” added`)
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not add the folder.',
      ),
  })

  const move = useMutation({
    mutationFn: (folderId: string | null) =>
      moveRecordsToFolder(projectId, [...selected], folderId),
    onSuccess: (n, folderId) => {
      invalidate()
      setSelected(new Set())
      setMoving(false)
      const dest = folders.find((f) => f.id === folderId)?.name ?? 'Unfiled'
      toast(`Moved ${n} ${n === 1 ? 'item' : 'items'} to ${dest}`)
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not move the items.',
      ),
  })

  const allOn = shown.length > 0 && shown.every((r) => selected.has(r.id))
  // `project_members` derives `access_level` from the same permissions the
  // folder RPCs enforce (`internal.can_edit_project`: the lead, a workspace
  // owner/admin, or a project owner/editor), so owner or editor is exactly the
  // server's `can_edit`. A project with a lead is not by itself editable.
  const access = membersQuery.data?.find(
    (member) => member.user_id === context.user.id,
  )?.access_level
  const canEdit = access === 'owner' || access === 'editor'

  // Sidebar indentation follows the folder tree, not one level: a folder nested
  // inside another nested folder sits deeper than its parent.
  const depths = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    const values = new Map<string, number>()
    for (const folder of folders) {
      let depth = 0
      let parentId = folder.parent_id
      // Bounded by the folder count, so a malformed chain cannot spin.
      while (parentId && depth < folders.length) {
        depth += 1
        parentId = byId.get(parentId)?.parent_id ?? null
      }
      values.set(folder.id, depth)
    }
    return values
  }, [folders])

  if (!project) return null

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[240px] shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-3 max-lg:hidden">
        <span className="px-2 pb-1 text-label font-medium text-fg-muted">
          Folders
        </span>
        <FolderRow
          label="Unfiled"
          icon="archive"
          count={count(UNFILED)}
          current={current === UNFILED}
          onClick={() => setCurrent(UNFILED)}
        />
        {folders.map((f) => (
          <FolderRow
            key={f.id}
            label={f.name}
            icon="folder"
            depth={depths.get(f.id) ?? 0}
            count={count(f.id)}
            current={current === f.id}
            onClick={() => setCurrent(f.id)}
          />
        ))}
        {canEdit ? (
          <div className="mt-2">
            <NewFolder
              parents={folders}
              busy={addFolder.isPending}
              onCreate={(name, parentId) =>
                addFolder.mutate({ name, parentId })
              }
            />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-4 py-[18px] md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-section">{currentFolder?.name ?? 'Unfiled'}</h2>
          <span className="text-label text-fg-muted">
            {shown.length} {shown.length === 1 ? 'item' : 'items'}
          </span>
          <span className="flex-1" />
          {selected.size ? (
            <span className="text-label text-fg-muted">
              {selected.size} selected
            </span>
          ) : null}
          <Button
            size="sm"
            icon="move"
            disabled={!selected.size || move.isPending}
            onClick={() => setMoving(true)}
          >
            Move…
          </Button>
        </div>

        {shown.length ? (
          <TableBox>
            <Table aria-label={`Items in ${currentFolder?.name ?? 'Unfiled'}`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9">
                    <Checkbox
                      aria-label="Select all items"
                      checked={allOn}
                      onCheckedChange={(on) =>
                        setSelected(
                          on ? new Set(shown.map((r) => r.id)) : new Set(),
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id} selected={selected.has(r.id)}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${r.identifier}`}
                        checked={selected.has(r.id)}
                        onCheckedChange={(on) =>
                          setSelected((s) => {
                            const n = new Set(s)
                            if (on) n.add(r.id)
                            else n.delete(r.id)
                            return n
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>
                      {r.kind} · <span className="mono">{r.identifier}</span>
                    </TableCell>
                    <TableCell>
                      <Status tone={statusTone(r.status)}>
                        {statusLabel(r.status)}
                      </Status>
                    </TableCell>
                    <TableCell align="right" className="text-fg-muted">
                      {r.updatedAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="folder"
            title={`Nothing in ${currentFolder?.name ?? 'Unfiled'} yet`}
            body="Select items in another folder and choose Move… to file them here."
          />
        )}

        <Muted>
          Folders only organise. Moving an item keeps its ID, links, history and
          access; nothing that cites it breaks.
        </Muted>
      </div>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title={`Move ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
            description={`${project.title} / ${currentFolder?.name ?? 'Unfiled'}`}
          />
          <DialogBody>
            <Field label="Move to">
              <Select
                id="move-dest"
                aria-label="Destination folder"
                defaultValue={current}
              >
                <option value={UNFILED}>Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Notice icon="info">
              IDs, links, history and access stay the same.
            </Notice>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              disabled={move.isPending}
              onClick={() => {
                const value = (
                  document.getElementById(
                    'move-dest',
                  ) as HTMLSelectElement | null
                )?.value
                if (!value) return
                move.mutate(value === UNFILED ? null : value)
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FolderRow({
  label,
  icon,
  depth = 0,
  count,
  current,
  onClick,
}: {
  label: string
  icon: 'folder' | 'archive'
  depth?: number
  count: number
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      className={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 pr-2 text-left text-body ${
        current
          ? 'bg-selection font-medium'
          : 'bg-transparent hover:bg-surface-hover'
      }`}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <Icon name={icon} size={14} />
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="text-label text-fg-muted">{count}</span> : null}
    </button>
  )
}

function NewFolder({
  parents,
  busy,
  onCreate,
}: {
  parents: ProjectFolder[]
  busy: boolean
  onCreate: (name: string, parentId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const top = useMemo(() => parents.filter((f) => !f.parent_id), [parents])
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setError(null)
      }}
    >
      <Button
        variant="quiet"
        size="sm"
        icon="plus"
        onClick={() => setOpen(true)}
      >
        New folder
      </Button>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title="New folder"
          description="Folders only organise; they never change IDs or access."
        />
        <DialogBody>
          <Field label="Name" required error={error ?? undefined}>
            <Input
              value={name}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
          </Field>
          <Field label="Inside">
            <Select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Top level</option>
              {top.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (!name.trim()) {
                setError('Enter a folder name.')
                return
              }
              onCreate(name.trim(), parentId || null)
              setOpen(false)
              setName('')
              setParentId('')
            }}
          >
            Add folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
