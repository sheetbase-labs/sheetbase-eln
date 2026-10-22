import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { RecordPicker } from '#/components/v3/record-picker/record-picker'
import type { PickerItem } from '#/components/v3/record-picker/record-picker-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { addRunToNotebook } from '#/lib/pipelines/run-notebook'
import type { CitationParagraph } from '#/lib/pipelines/run-notebook'

/**
 * Cite a pipeline run in an experiment's notebook: the pipeline, run time,
 * inputs and kept datasets go in as a block of text with links to each. Nothing is signed or submitted.
 */
export function AddRunToNotebook({
  paragraphs,
}: {
  paragraphs: CitationParagraph[]
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<PickerItem | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!target) return
    setBusy(true)
    try {
      const { identifier } = await addRunToNotebook(notebookDataClient, {
        recordId: target.id,
        paragraphs,
      })
      toast('Added to notebook', {
        description: `${identifier ?? 'The notebook'} now cites this run.`,
        action: {
          label: 'Open notebook',
          onClick: () =>
            void navigate({
              to: '/experiments/$expId/notebook',
              params: { expId: target.id },
            }),
        },
      })
      setOpen(false)
      setTarget(null)
    } catch (error) {
      toast.error('Could not add the run', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        Add to notebook
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setOpen(false))}>
          <DialogContent className="w-[min(560px,calc(100vw-32px))]">
            <DialogHeader
              title="Add this run to a notebook"
              description="Inserts a block linking the pipeline, the run, the datasets it read and the ones it kept. The notebook's own signing covers it."
            />
            <DialogBody>
              <div className="min-h-[220px] rounded-md border border-border">
                <RecordPicker
                  allowed={['Experiment']}
                  exclude={[]}
                  onPick={(items) => setTarget(items[0] ?? null)}
                />
              </div>
              {target ? (
                <span className="text-label text-fg-muted">
                  Adding to {target.identifier} · {target.name}
                </span>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                Cancel
              </DialogClose>
              <Button
                variant="primary"
                disabled={busy || !target}
                onClick={() => void add()}
              >
                {busy ? 'Adding…' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
