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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ConvertDialog } from '#/components/pipelines/convert-dialog'
import { DuplicateDialog } from '#/components/pipelines/history/duplicate-dialog'
import { versionMode } from '#/lib/pipelines/version-mode'
import { toast } from '#/components/ui/sonner'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { updatePipelineDefinition } from '#/lib/pipelines/data'
import { readStoredConfig } from '#/lib/pipelines/step-list'
import { versionFileText } from '#/lib/pipelines/version-file'
import { ConvertToAdvancedDialog } from '#/components/pipelines/advanced/convert-to-advanced'
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
  const [duplicating, setDuplicating] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertingFile, setConvertingFile] = useState(false)
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
          <DropdownMenuItem
            icon="history"
            onClick={() =>
              void navigate({
                to: '/pipelines/$pipelineId/triggers',
                params: { pipelineId: editor.pipelineId },
                hash: 'history',
              })
            }
          >
            {t('data.pipelineMenu.history')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="copy"
            disabled={!shown}
            onClick={() => setDuplicating(true)}
          >
            {t('features.pipelineSimple.history.duplicateMenu')}
          </DropdownMenuItem>
          {shown && versionMode(shown) === 'simple' ? (
            <DropdownMenuItem
              icon="arrowRightLeft"
              onClick={() => setConverting(true)}
            >
              {t('features.pipelineSimple.convert.menu')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon="download"
            disabled={!shown}
            onClick={() => {
              if (!shown) return
              const config = readStoredConfig(shown.configuration)

              if (!config) return

              download(
                `${editor.definition.data?.key ?? 'pipeline'}-v${shown.version}.yaml`,
                versionFileText(config, {
                  title: editor.definition.data?.name,
                  pipeline:
                    editor.definition.data?.display_id ??
                    editor.definition.data?.key ??
                    '',
                  version: shown.version,
                }),
                'text/yaml',
              )
            }}
          >
            {t('data.pipelineMenu.downloadFile')}
          </DropdownMenuItem>
          {editor.advanced ? null : (
            <DropdownMenuItem
              icon="code"
              onClick={() => setConvertingFile(true)}
            >
              {t('features.pipelineVersionFile.convert.menu')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="archive" onClick={() => setRetiring(true)}>
            {t('data.pipelineMenu.retire')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {shown ? (
        <>
          <DuplicateDialog
            open={duplicating}
            onOpenChange={setDuplicating}
            workspaceId={editor.workspaceId}
            versionId={shown.id}
            version={shown.version}
            mode={t(`features.pipelineSimple.mode.${versionMode(shown)}`)}
            displayId={editor.definition.data?.display_id ?? ''}
            name={name}
          />
          {versionMode(shown) === 'simple' ? (
            <ConvertDialog
              open={converting}
              onOpenChange={setConverting}
              workspaceId={editor.workspaceId}
              pipelineId={editor.pipelineId}
              displayId={editor.definition.data?.display_id ?? ''}
              name={name}
              draftVersion={
                editor.draft ? editor.draft.version : shown.version + 1
              }
              publishedVersion={editor.current?.version ?? null}
              onConverted={() => undefined}
              onDuplicate={() => {
                setConverting(false)
                setDuplicating(true)
              }}
            />
          ) : null}
        </>
      ) : null}

      {convertingFile ? (
        <ConvertToAdvancedDialog onClose={() => setConvertingFile(false)} />
      ) : null}

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
