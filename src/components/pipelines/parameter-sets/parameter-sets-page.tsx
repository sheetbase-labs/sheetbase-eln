import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { PageHeader } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { ParametersEditor } from '#/components/pipelines/parameters-editor'
import { notebookDataClient, formatNotebookDateTime } from '#/lib/notebook-data'
import { PARAMETER_SET_KEY } from '#/lib/pipelines/config'
import type { PipelineParameter } from '#/lib/pipelines/config'
import type { copy as pageCopy } from '#/features/pipeline-parameter-sets/copy'

import {
  deleteParameterSet,
  parameterSetKeys,
  saveParameterSet,
  usePipelineParameterSets,
} from './parameter-sets-data'
import type { ParameterSetRow } from './parameter-sets-data'

const words = (
  key: Exclude<keyof typeof pageCopy.page, 'deleteTitle' | 'usedIn'>,
) => t(`features.pipelineParameterSets.page.${key}`)

interface Draft {
  id: string | null
  key: string
  name: string
  description: string
  parameters: PipelineParameter[]
}

const blank: Draft = {
  id: null,
  key: '',
  name: '',
  description: '',
  parameters: [],
}

/** The parameter sets of the workspace: made once, included by name in a version file. */
export function ParameterSetsPage({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const sets = usePipelineParameterSets()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<ParameterSetRow | null>(null)
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: (row: ParameterSetRow) =>
      deleteParameterSet(notebookDataClient, workspaceId, row.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: parameterSetKeys.list })
      setDeleting(null)
      toast(words('deleted'))
    },
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: words('pipelines'), link: { to: '/pipelines' } },
          { label: words('title') },
        ]}
        title={words('title')}
        meta={<span>{words('intro')}</span>}
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setEditing(blank)}
            >
              {words('newSet')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 px-4 py-4 md:px-6">
        {canManage ? null : <Notice tone="info">{words('readOnly')}</Notice>}
        {sets.isError ? <Notice tone="bad">{words('failed')}</Notice> : null}
        <TableBox>
          <Table caption={words('title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{words('colName')}</TableHead>
                <TableHead>{words('colKey')}</TableHead>
                <TableHead>{words('colParameters')}</TableHead>
                <TableHead>{words('colUpdated')}</TableHead>
                <TableHead>
                  <span className="sr-only">{words('colActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              loading={sets.isLoading}
              empty={words('empty')}
              colSpan={5}
            >
              {(sets.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="mono">{row.key}</TableCell>
                  <TableCell className="mono">
                    {row.parameters.length
                      ? row.parameters.map((p) => p.name).join(', ')
                      : words('none')}
                  </TableCell>
                  <TableCell>
                    {formatNotebookDateTime(row.updated_at)}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <span className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() =>
                            setEditing({
                              id: row.id,
                              key: row.key,
                              name: row.name,
                              description: row.description ?? '',
                              parameters: row.parameters,
                            })
                          }
                        >
                          {words('edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => setDeleting(row)}
                        >
                          {words('delete')}
                        </Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </div>
      {editing ? (
        <SetDialog
          key={editing.id ?? 'new'}
          draft={editing}
          workspaceId={workspaceId}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('features.pipelineParameterSets.page.deleteTitle', {
                name: deleting?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {words('deleteBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>{words('cancel')}</ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {words('deleteConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function SetDialog({
  draft,
  workspaceId,
  onClose,
}: {
  draft: Draft
  workspaceId: string
  onClose: () => void
}) {
  const [f, setF] = useState(draft)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const keyError = PARAMETER_SET_KEY.test(f.key) ? null : words('keyBad')
  const nameError = f.name.trim() ? null : words('nameNeeded')

  const save = useMutation({
    mutationFn: () =>
      saveParameterSet(notebookDataClient, {
        workspaceId,
        key: f.key,
        name: f.name.trim(),
        description: f.description.trim() || null,
        parameters: f.parameters,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: parameterSetKeys.list })
      toast(words('saved'))
      onClose()
    },
    onError: (error) =>
      setServerError(error instanceof Error ? error.message : words('failed')),
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={draft.id ? words('editSet') : words('newSet')}
          description={words('intro')}
        />
        <DialogBody>
          <Field
            label={words('name')}
            required
            error={tried ? nameError : null}
          >
            <Input
              autoFocus
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field
            label={words('key')}
            required
            hint={words('keyHint')}
            error={tried ? keyError : null}
          >
            <Input
              className="mono"
              value={f.key}
              disabled={draft.id !== null}
              onChange={(e) => setF({ ...f, key: e.target.value })}
            />
          </Field>
          <Field label={words('description')} hint={words('optional')}>
            <Input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          <Field label={words('parametersLabel')}>
            <ParametersEditor
              parameters={f.parameters}
              onChange={(parameters) => setF({ ...f, parameters })}
            />
          </Field>
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {words('cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              setTried(true)

              if (keyError || nameError) return
              save.mutate()
            }}
          >
            {save.isPending ? words('saving') : words('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
