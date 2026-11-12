import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
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
  DialogContent,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  pipelineDataQueryKeys,
  versionStatus,
} from '#/components/pipelines/pipelines-data'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { updatePipelineDefinition } from '#/lib/pipelines/data'
import { configForWire, readStoredConfig } from '#/lib/pipelines/step-list'
import { usePipelineEditor } from './use-pipeline-editor'

/** Save text as a file in the browser. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')

  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * The ⋯ of the pipeline header: Run now, History, Download version file, Retire.
 * Duplicate and Convert are the next builds' to add here, each one item.
 */
export function PipelineMenu({
  onRun,
  canRun,
}: {
  onRun: () => void
  canRun: boolean
}) {
  const editor = usePipelineEditor()
  const [history, setHistory] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const name = editor.definition.data?.name ?? ''

  const retire = useMutation({
    mutationFn: () =>
      updatePipelineDefinition(notebookDataClient, {
        workspaceId: editor.workspaceId,
        definitionId: editor.pipelineId,
        lifecycle: 'retired',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.list,
      })
      toast(t('data.pipelinesList.archivedToast', { name }))
      void navigate({ to: '/pipelines' })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t('common.errors.generic'),
      ),
  })

  const shown = editor.source

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('data.pipelineMenu.aria', {
            id: editor.definition.data?.display_id ?? '',
          })}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-fg hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus aria-expanded:border-border-strong aria-expanded:bg-surface-hover max-md:size-10"
        >
          <Icon name="more" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuItem icon="play" disabled={!canRun} onClick={onRun}>
            {t('data.pipelineMenu.runNow')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="history" onClick={() => setHistory(true)}>
            {t('data.pipelineMenu.history')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="download"
            disabled={!shown}
            onClick={() => {
              if (!shown) return
              const config = readStoredConfig(shown.configuration)

              download(
                `${editor.definition.data?.key ?? 'pipeline'}-v${shown.version}.json`,
                `${JSON.stringify(config ? configForWire(config) : shown.configuration, null, 2)}\n`,
                'application/json',
              )
            }}
          >
            {t('data.pipelineMenu.downloadFile')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="archive" onClick={() => setRetiring(true)}>
            {t('data.pipelineMenu.retire')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={history} onOpenChange={setHistory}>
        <DialogContent>
          <DialogHeader
            title={t('data.pipelineMenu.historyTitle')}
            description={t('data.pipelineMenu.historyBody')}
          />
          <DialogBody>
            <ol className="m-0 flex list-none flex-col p-0">
              {editor.list.map((version) => {
                const status = versionStatus(version.lifecycle)

                return (
                  <li
                    key={version.id}
                    className="grid grid-cols-[48px_110px_minmax(0,1fr)] items-center gap-2 border-b border-border-subtle py-2 text-body last:border-b-0"
                  >
                    <span className="num font-medium">v{version.version}</span>
                    <Status tone={status.tone}>{status.label}</Status>
                    <span className="text-label text-fg-muted">
                      {version.published_at
                        ? formatNotebookDateTime(version.published_at, {
                            zone: true,
                          })
                        : '—'}
                    </span>
                  </li>
                )
              })}
            </ol>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={retiring} onOpenChange={setRetiring}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.pipelineMenu.retireTitle', { name })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('data.pipelineMenu.retireBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction onClick={() => retire.mutate()}>
              {t('data.pipelineMenu.retireConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}
