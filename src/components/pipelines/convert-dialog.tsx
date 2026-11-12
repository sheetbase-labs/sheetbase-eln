import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import { words } from '#/lib/pipelines/simple/words'
import { notebookDataClient } from '#/lib/notebook-data'
import { convertPipelineToStandard } from '#/lib/pipelines/simple/data'

const c = words('convert')

function Line({
  icon,
  children,
}: {
  icon: IconName
  children: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[18px_1fr] items-start gap-2">
      <Icon name={icon} size={13} className="mt-[3px] text-fg-muted" />
      <span>{children}</span>
    </li>
  )
}

/**
 * Convert Simple to Standard: the one-way step. It says what changes, what
 * happens to the versions and that it cannot be undone, and offers to
 * duplicate the pipeline first for anyone who wants to keep a Simple copy.
 */
export function ConvertDialog({
  open,
  onOpenChange,
  workspaceId,
  pipelineId,
  displayId,
  name,
  draftVersion,
  publishedVersion,
  onDuplicate,
  onConverted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  pipelineId: string
  displayId: string
  name: string
  /** The draft that becomes Standard, or the number the new draft will have. */
  draftVersion: number
  publishedVersion: number | null
  onDuplicate: () => void
  onConverted: () => void
}) {
  const queryClient = useQueryClient()

  const convert = useMutation({
    mutationFn: () =>
      convertPipelineToStandard(notebookDataClient, {
        workspaceId,
        definitionId: pipelineId,
      }),
    onSuccess: (version) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })
      toast(c('done'), {
        description: c('notice', { version: version.version }),
      })
      onOpenChange(false)
      onConverted()
    },
    onError: (error) =>
      toast.error(c('failed'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader title={c('title')} description={`${displayId} ${name}`} />
        <DialogBody className="flex flex-col gap-4">
          <section>
            <h3 className="m-0 mb-1.5 font-sans text-[12px] font-semibold">
              {c('changes')}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-[19px]">
              <Line icon="pipeline">{c('changesText')}</Line>
              <Line icon="edit">{c('sentence')}</Line>
              <Line icon="lock">
                <b className="font-semibold">{c('oneWay')}</b> {c('oneWayText')}
              </Line>
            </ul>
          </section>
          <section>
            <h3 className="m-0 mb-1.5 font-sans text-[12px] font-semibold">
              {c('versions')}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-[19px]">
              <Line icon="plus">
                {c('draftCreates', { version: draftVersion })}
              </Line>
              <Line icon="play">
                {publishedVersion === null
                  ? c('keepsRunningNone')
                  : c('keepsRunning', {
                      published: publishedVersion,
                      version: draftVersion,
                    })}
              </Line>
              <Line icon="clock">{c('readable')}</Line>
            </ul>
          </section>
          <Notice tone="info" icon={false}>
            {c('copyFirst')}{' '}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-link"
              onClick={onDuplicate}
            >
              {c('duplicate', { id: displayId })}
            </button>
          </Notice>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{c('cancel')}</Button>
          <Button
            variant="primary"
            disabled={convert.isPending}
            onClick={() => convert.mutate()}
          >
            {convert.isPending ? c('working') : c('action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
