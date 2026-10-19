import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { toast } from '#/components/v3/ui/sonner'
import { ProjectList, ProjectListFailure } from './project-list'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import {
  archiveSheetInstance,
  fetchProjectSheets,
  renameSheetInstance,
  restoreSheetInstance,
} from '#/lib/sheet-instance-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'

export const projectSheetsKey = (projectId: string, archived: boolean) =>
  [
    'ui-port',
    'project-sheets',
    projectId,
    archived ? 'archived' : 'active',
  ] as const

/** What a sheet was made from, in the words a person uses. */
export function sheetOrigin(
  sheet: Pick<
    SheetInstance,
    'sourceDefinitionVersionId' | 'duplicatedFromInstanceId'
  >,
) {
  if (sheet.sourceDefinitionVersionId) return 'From a sheet definition'
  if (sheet.duplicatedFromInstanceId) return 'Copy of another sheet'
  return 'Working sheet'
}

/**
 * The project's Sheets tab: every working sheet in the project, where it came
 * from, and the two things worth doing to one from a list, rename and archive.
 * Archived sheets are one toggle away and can be restored.
 */
export function ProjectSheets({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState<SheetInstance | null>(null)
  const [name, setName] = useState('')
  const sheets = useQuery({
    queryKey: projectSheetsKey(projectId, showArchived),
    queryFn: () => fetchProjectSheets(projectId, { archived: showArchived }),
  })
  const rows = sheets.data ?? []

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'project-sheets'] })
  const failed = (title: string) => (error: unknown) =>
    toast.error(
      `${title} ${error instanceof Error ? error.message : 'Please try again.'}`,
    )

  const rename = useMutation({
    mutationFn: (input: { sheet: SheetInstance; name: string }) =>
      renameSheetInstance(input.sheet.id, input.sheet.revision, input.name),
    onSuccess: async () => {
      setRenaming(null)
      await refresh()
      toast('Sheet renamed')
    },
    onError: failed('Could not rename the sheet.'),
  })
  const archive = useMutation({
    mutationFn: (sheet: SheetInstance) =>
      archiveSheetInstance(sheet.id, sheet.revision),
    onSuccess: async (sheet) => {
      await refresh()
      toast(`${sheet.name} archived`, {
        description: 'Show archived sheets to restore it.',
      })
    },
    onError: failed('Could not archive the sheet.'),
  })
  const restore = useMutation({
    mutationFn: (sheet: SheetInstance) =>
      restoreSheetInstance(sheet.id, sheet.revision),
    onSuccess: async (sheet) => {
      await refresh()
      toast(`${sheet.name} restored`)
    },
    onError: failed('Could not restore the sheet.'),
  })
  const busy = rename.isPending || archive.isPending || restore.isPending

  if (sheets.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={sheets.error}
          onRetry={() => void sheets.refetch()}
          what="this project's sheets"
        />
      </div>
    )
  }

  const display = rows.map((s) => ({ key: s.id, sheet: s }))
  return (
    <>
      <ProjectList
        title={showArchived ? 'Archived sheets' : 'Sheets'}
        count={sheets.isPending ? undefined : rows.length}
        action={
          <span className="flex items-center gap-3">
            <button
              type="button"
              className="text-label text-link"
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? 'Show working sheets' : 'Show archived'}
            </button>
            {showArchived ? null : (
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link to="/sheets/new" search={{ project: projectId }} />
                }
              >
                New sheet
              </Button>
            )}
          </span>
        }
        cols={[
          {
            key: 'name',
            label: 'Sheet',
            cell: ({ sheet }) => (
              <span className="flex flex-col">
                <ObjectLink kind="sheet" id={sheet.id} mono={false}>
                  {sheet.name}
                </ObjectLink>
                {sheet.displayId ? (
                  <span className="mono text-caption text-fg-muted">
                    {sheet.displayId}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'origin',
            label: 'Made from',
            cell: ({ sheet }) => (
              <span className="text-fg-muted">{sheetOrigin(sheet)}</span>
            ),
          },
          {
            key: 'notebook',
            label: 'Notebook',
            cell: ({ sheet }) =>
              sheet.notebookRecordId ? (
                <ObjectLink kind="experiment" id={sheet.notebookRecordId}>
                  Open notebook
                </ObjectLink>
              ) : (
                <span className="text-fg-muted">Not in a notebook</span>
              ),
          },
          {
            key: 'updated',
            label: 'Changed',
            align: 'right',
            cell: ({ sheet }) => (
              <span className="text-fg-muted">
                {formatNotebookDateTime(sheet.updatedAt)}
              </span>
            ),
          },
          {
            key: 'actions',
            label: <span className="sr-only">Actions</span>,
            align: 'right',
            cell: ({ sheet }) =>
              showArchived ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => restore.mutate(sheet)}
                >
                  Restore
                </Button>
              ) : (
                <span className="flex justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      setName(sheet.name)
                      setRenaming(sheet)
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => archive.mutate(sheet)}
                  >
                    Archive
                  </Button>
                </span>
              ),
          },
        ]}
        rows={display}
        mobile={display.map(({ key, sheet }) => ({
          key,
          title: sheet.name,
          meta: sheetOrigin(sheet),
          link: { to: '/sheets/$sheetId', params: { sheetId: sheet.id } },
        }))}
        empty={{
          icon: 'table',
          title: showArchived ? 'No archived sheets' : 'No sheets yet',
          body: showArchived
            ? 'Sheets you archive in this project are listed here, ready to restore.'
            : 'A sheet is a place to try things on data before it becomes a dataset. Start one for this project.',
          action: showArchived ? undefined : (
            <Button
              size="sm"
              variant="primary"
              nativeButton={false}
              render={<Link to="/sheets/new" search={{ project: projectId }} />}
            >
              New sheet
            </Button>
          ),
        }}
      />
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => (open ? null : setRenaming(null))}
      >
        <DialogContent>
          <DialogHeader
            title="Rename sheet"
            description="Only the name changes; the sheet’s data and history stay as they are."
          />
          <DialogBody>
            <Field label="Name" required>
              <Input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="primary"
              disabled={
                !name.trim() ||
                name.trim() === renaming?.name ||
                rename.isPending
              }
              onClick={() =>
                renaming ? rename.mutate({ sheet: renaming, name }) : undefined
              }
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
