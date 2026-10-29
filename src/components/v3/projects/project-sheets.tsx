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
import { t } from '#/copy'
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
  if (sheet.sourceDefinitionVersionId)
    return t('projects.projectSheets.origin.definition')
  if (sheet.duplicatedFromInstanceId)
    return t('projects.projectSheets.origin.copy')
  return t('projects.projectSheets.origin.working')
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
      t('projects.projectSheets.failed', {
        title,
        reason:
          error instanceof Error
            ? error.message
            : t('projects.projectSheets.pleaseTryAgain'),
      }),
    )

  const rename = useMutation({
    mutationFn: (input: { sheet: SheetInstance; name: string }) =>
      renameSheetInstance(input.sheet.id, input.sheet.revision, input.name),
    onSuccess: async () => {
      setRenaming(null)
      await refresh()
      toast(t('projects.projectSheets.renamed'))
    },
    onError: failed(t('projects.projectSheets.renameFailed')),
  })
  const archive = useMutation({
    mutationFn: (sheet: SheetInstance) =>
      archiveSheetInstance(sheet.id, sheet.revision),
    onSuccess: async (sheet) => {
      await refresh()
      toast(t('projects.projectSheets.archived', { name: sheet.name }), {
        description: t('projects.projectSheets.archivedHint'),
      })
    },
    onError: failed(t('projects.projectSheets.archiveFailed')),
  })
  const restore = useMutation({
    mutationFn: (sheet: SheetInstance) =>
      restoreSheetInstance(sheet.id, sheet.revision),
    onSuccess: async (sheet) => {
      await refresh()
      toast(t('projects.projectSheets.restored', { name: sheet.name }))
    },
    onError: failed(t('projects.projectSheets.restoreFailed')),
  })
  const busy = rename.isPending || archive.isPending || restore.isPending

  if (sheets.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={sheets.error}
          onRetry={() => void sheets.refetch()}
          what={t('projects.projectSheets.what')}
        />
      </div>
    )
  }

  const display = rows.map((s) => ({ key: s.id, sheet: s }))
  return (
    <>
      <ProjectList
        title={
          showArchived
            ? t('projects.projectSheets.archivedTitle')
            : t('projects.projectSheets.title')
        }
        count={sheets.isPending ? undefined : rows.length}
        action={
          <span className="flex items-center gap-3">
            <button
              type="button"
              className="text-label text-link"
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived
                ? t('projects.projectSheets.showWorking')
                : t('projects.projectSheets.showArchived')}
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
                {t('projects.projectSheets.newSheet')}
              </Button>
            )}
          </span>
        }
        cols={[
          {
            key: 'name',
            label: t('projects.projectSheets.columns.sheet'),
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
            label: t('projects.projectSheets.columns.madeFrom'),
            cell: ({ sheet }) => (
              <span className="text-fg-muted">{sheetOrigin(sheet)}</span>
            ),
          },
          {
            key: 'notebook',
            label: t('projects.projectSheets.columns.notebook'),
            cell: ({ sheet }) =>
              sheet.notebookRecordId ? (
                <ObjectLink kind="experiment" id={sheet.notebookRecordId}>
                  {t('projects.projectSheets.openNotebook')}
                </ObjectLink>
              ) : (
                <span className="text-fg-muted">
                  {t('projects.projectSheets.noNotebook')}
                </span>
              ),
          },
          {
            key: 'updated',
            label: t('projects.projectSheets.columns.changed'),
            align: 'right',
            cell: ({ sheet }) => (
              <span className="text-fg-muted">
                {formatNotebookDateTime(sheet.updatedAt)}
              </span>
            ),
          },
          {
            key: 'actions',
            label: (
              <span className="sr-only">
                {t('projects.projectSheets.columns.actions')}
              </span>
            ),
            align: 'right',
            cell: ({ sheet }) =>
              showArchived ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => restore.mutate(sheet)}
                >
                  {t('common.actions.restore')}
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
                    {t('common.actions.rename')}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={busy}
                    onClick={() => archive.mutate(sheet)}
                  >
                    {t('common.actions.archive')}
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
          title: showArchived
            ? t('projects.projectSheets.empty.archivedTitle')
            : t('projects.projectSheets.empty.title'),
          body: showArchived
            ? t('projects.projectSheets.empty.archivedBody')
            : t('projects.projectSheets.empty.body'),
          action: showArchived ? undefined : (
            <Button
              size="sm"
              variant="primary"
              nativeButton={false}
              render={<Link to="/sheets/new" search={{ project: projectId }} />}
            >
              {t('projects.projectSheets.newSheet')}
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
            title={t('projects.projectSheets.rename.title')}
            description={t('projects.projectSheets.rename.description')}
          />
          <DialogBody>
            <Field label={t('projects.projectSheets.rename.name')} required>
              <Input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
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
              {t('common.actions.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
