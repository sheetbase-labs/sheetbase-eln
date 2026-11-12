import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
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
  const [understood, setUnderstood] = useState(false)
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)

        if (!next) setUnderstood(false)
      }}
    >
      <DialogContent>
        <DialogHeader title={c('title')} description={`${displayId} ${name}`} />
        <DialogBody className="flex flex-col gap-4 text-label">
          <section>
            <h3 className="m-0 mb-1 font-sans text-label font-semibold">
              {c('changes')}
            </h3>
            <p className="m-0">{c('changesText')}</p>
            <p className="m-0 mt-1 text-fg-muted">{c('sentence')}</p>
          </section>
          <section>
            <h3 className="m-0 mb-1 font-sans text-label font-semibold">
              {c('oneWay')}
            </h3>
            <p className="m-0">{c('oneWayText')}</p>
          </section>
          <section>
            <h3 className="m-0 mb-1 font-sans text-label font-semibold">
              {c('versions')}
            </h3>
            <p className="m-0">
              {c('draftCreates', { version: draftVersion })}
            </p>
            <p className="m-0 text-fg-muted">
              {publishedVersion === null
                ? c('keepsRunningNone')
                : c('keepsRunning', {
                    published: publishedVersion,
                    version: draftVersion,
                  })}
            </p>
            <p className="m-0 text-fg-muted">{c('readable')}</p>
          </section>
          <section className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2">
            <span className="grow text-fg-muted">{c('copyFirst')}</span>
            <Button size="sm" onClick={onDuplicate}>
              {c('duplicate', { id: displayId })}
            </Button>
          </section>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={understood}
              onCheckedChange={(checked) => setUnderstood(checked === true)}
            />
            {c('understand')}
          </label>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{c('cancel')}</Button>
          <Button
            variant="primary"
            disabled={!understood || convert.isPending}
            onClick={() => convert.mutate()}
          >
            {convert.isPending ? c('working') : c('action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
