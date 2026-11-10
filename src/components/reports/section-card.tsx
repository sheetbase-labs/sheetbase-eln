import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { BlockPreview } from '#/components/notebook/block-preview'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import { Textarea } from '#/components/inventory/list'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  frozenBlockOf,
  removeSection,
  reportKeys,
  updateSection,
  validationLabel,
} from '#/lib/reports'
import type { ReportSection } from '#/lib/reports'
import type { NotebookBlock } from '#/lib/notebook-data'
import { t } from '#/copy'

/**
 * One section of the report, in the order it will appear. A text section is
 * edited in place; an evidence section shows the block it froze and whether
 * its source still matches. A locked report shows both without controls.
 */
/** Stands in for the record's identifier while the sentence is split around it. */
const SOURCE_MARK = '\u0001'

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

  return (
    <section
      aria-label={t('projects.reports.section.label', {
        title: section.title,
        n: index + 1,
      })}
      className="rounded-md border border-border bg-surface"
    >
      <SectionHeader
        section={section}
        index={index}
        total={total}
        isText={isText}
        locked={locked}
        title={title}
        onTitleChange={setTitle}
        onMove={onMove}
        onRemove={() => setConfirmRemove(true)}
      />
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
          <SectionSource section={section} frozen={frozen} />
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

/** A section's title, its badge and its controls, or its heading when locked. */
function SectionHeader({
  section,
  index,
  total,
  isText,
  locked,
  title,
  onTitleChange,
  onMove,
  onRemove,
}: {
  section: ReportSection
  index: number
  total: number
  isText: boolean
  locked: boolean
  title: string
  onTitleChange: (title: string) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  return (
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
          onChange={(e) => onTitleChange(e.target.value)}
        />
      )}
      <span className="text-label text-fg-muted">
        {isText
          ? t('projects.reports.section.textBadge')
          : t('projects.reports.section.evidenceBadge')}
      </span>
      {isText ? null : (
        <Status tone={validationLabel(section.validationStatus).tone}>
          {validationLabel(section.validationStatus).label}
        </Status>
      )}
      {locked ? null : (
        <span className="flex items-center gap-0.5">
          <IconButton
            variant="quiet"
            icon="arrowUp"
            label={t('projects.reports.section.moveUp')}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            variant="quiet"
            icon="arrowDown"
            label={t('projects.reports.section.moveDown')}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          />
          <IconButton
            variant="quiet"
            icon="trash"
            label={t('projects.reports.section.remove')}
            onClick={onRemove}
          />
        </span>
      )}
    </header>
  )
}

/** Where an evidence section came from, and the block it froze. */
function SectionSource({
  section,
  frozen,
}: {
  section: ReportSection
  frozen: NotebookBlock | null
}) {
  const ref = section.sourceRef

  return (
    <>
      {ref.recordIdentifier ? (
        <p className="text-label text-fg-muted">
          {t('projects.reports.section.from', {
            record: SOURCE_MARK,
            version: ref.revisionVersion ?? 1,
          })
            .split(SOURCE_MARK)
            .flatMap((part, partIndex) =>
              partIndex === 0
                ? [part]
                : [
                    <ObjectLink
                      key="source"
                      kind="experiment"
                      identifier={ref.recordIdentifier}
                    />,
                    part,
                  ],
            )}
        </p>
      ) : null}
      {frozen ? (
        <div className="rounded-md bg-surface-muted p-2">
          <BlockPreview block={frozen} frozen />
        </div>
      ) : null}
    </>
  )
}
