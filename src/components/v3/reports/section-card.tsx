import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { BlockPreview } from '#/components/notebook/block-preview'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Input } from '#/components/v3/ui/input'
import { Status } from '#/components/v3/ui/status'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  frozenBlockOf,
  removeSection,
  reportKeys,
  updateSection,
  validationLabel,
} from '#/lib/reports'
import type { ReportSection } from '#/lib/reports'
import { t } from '#/copy'

/**
 * One section of the report, in the order it will appear. A text section is
 * edited in place; an evidence section shows the block it froze and whether
 * its source still matches. A locked report shows both without controls.
 */
export function SectionCard({
  section,
  index,
  total,
  recordId,
  workspaceId,
  locked,
  onMove,
}: {
  section: ReportSection
  index: number
  total: number
  recordId: string
  workspaceId: string
  locked: boolean
  onMove: (direction: -1 | 1) => void
}) {
  const queryClient = useQueryClient()
  const isText = section.sourceType === 'free_text'
  const [title, setTitle] = useState(section.title)
  const [body, setBody] = useState(section.description ?? '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const dirty =
    title.trim() !== section.title || body !== (section.description ?? '')
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reportKeys.detail(recordId) })

  const save = useMutation({
    mutationFn: () =>
      updateSection(notebookDataClient, {
        workspaceId,
        sectionId: section.id,
        title: title.trim() || section.title,
        body: isText ? body : undefined,
      }),
    onSuccess: () => {
      toast(t('projects.reports.section.saved'))
      void refresh()
    },
    onError: () => toast.error(t('projects.reports.section.saveFailed')),
  })
  const remove = useMutation({
    mutationFn: () =>
      removeSection(notebookDataClient, {
        workspaceId,
        sectionId: section.id,
      }),
    onSuccess: () => {
      setConfirmRemove(false)
      toast(t('projects.reports.section.removed'))
      void refresh()
    },
    onError: () => toast.error(t('projects.reports.section.removeFailed')),
  })

  const frozen = isText ? null : frozenBlockOf(section)
  const check = validationLabel(section.validationStatus)
  const ref = section.sourceRef as {
    recordIdentifier?: string
    revisionVersion?: number
  }

  return (
    <section
      aria-label={t('projects.reports.section.label', {
        title: section.title,
        n: index + 1,
      })}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="num w-5 text-label text-fg-muted">{index + 1}</span>
        {locked ? (
          <h3 className="min-w-0 flex-1 font-heading text-doc font-semibold">
            {section.title}
          </h3>
        ) : (
          <Input
            aria-label={t('projects.reports.section.titleField')}
            className="min-w-0 flex-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <span className="text-label text-fg-muted">
          {isText
            ? t('projects.reports.section.textBadge')
            : t('projects.reports.section.evidenceBadge')}
        </span>
        {!isText ? <Status tone={check.tone}>{check.label}</Status> : null}
        {locked ? null : (
          <span className="flex items-center gap-0.5">
            <Button
              variant="quiet"
              size="icon"
              icon="arrowUp"
              aria-label={t('projects.reports.section.moveUp')}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            />
            <Button
              variant="quiet"
              size="icon"
              icon="arrowDown"
              aria-label={t('projects.reports.section.moveDown')}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            />
            <Button
              variant="quiet"
              size="icon"
              icon="trash"
              aria-label={t('projects.reports.section.remove')}
              onClick={() => setConfirmRemove(true)}
            />
          </span>
        )}
      </header>
      <div className="flex flex-col gap-2 px-3 py-3">
        {isText ? (
          locked ? (
            <p className="whitespace-pre-wrap text-body">
              {section.description}
            </p>
          ) : (
            <Textarea
              aria-label={t('projects.reports.section.bodyField')}
              rows={5}
              value={body}
              placeholder={t('projects.reports.section.bodyPlaceholder')}
              onChange={(e) => setBody(e.target.value)}
            />
          )
        ) : (
          <>
            {ref.recordIdentifier ? (
              <p className="text-label text-fg-muted">
                {t('projects.reports.section.from', {
                  record: ref.recordIdentifier,
                  version: ref.revisionVersion ?? 1,
                })}
              </p>
            ) : null}
            {frozen ? (
              <div className="rounded-md bg-surface-muted p-2">
                <BlockPreview block={frozen} frozen />
              </div>
            ) : null}
          </>
        )}
        {!locked && dirty ? (
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setTitle(section.title)
                setBody(section.description ?? '')
              }}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t('projects.reports.section.saving')
                : t('projects.reports.section.save')}
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('projects.reports.section.removeTitle', {
              title: section.title,
            })}
            description={t('projects.reports.section.removeBody')}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('projects.reports.section.removeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
