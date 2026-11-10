import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { addEvidenceSection, reportKeys } from '#/lib/reports'
import type { EvidenceChoice } from '#/lib/reports'
import { t } from '#/copy'

import { blockLabel } from './evidence-block-label'
import { EvidenceBlockTable } from './evidence-block-table'
import { useEvidencePicker } from './use-evidence-picker'

/**
 * Bring evidence into a report: pick a record that has been submitted, pick
 * the version, then pick one block of it. The block is frozen as it was. What
 * can be picked, and what is picked, is `use-evidence-picker.ts`'s; the block
 * list is `evidence-block-table.tsx`'s; this owns the dialog and the write.
 */
export function AddEvidenceDialog({
  open,
  onOpenChange,
  recordId,
  definitionId,
  workspaceId,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  definitionId: string
  workspaceId: string
  projectId: string | null
}) {
  const queryClient = useQueryClient()
  const picker = useEvidencePicker({ open, recordId, projectId })

  const {
    records,
    revisions,
    versions,
    chosenVersion,
    blocks,
    source,
    block,
    sourceId,
    blockId,
    title,
    setTitle,
    setBlockId,
    chooseSource,
    chooseVersion,
    reset,
  } = picker

  const add = useMutation({
    mutationFn: () => {
      if (!source || !chosenVersion || !block) throw new Error('incomplete')

      const evidence: EvidenceChoice = {
        revisionId: chosenVersion.id,
        blockId: block.id,
        blockType: block.type,
        recordIdentifier: source.identifier,
        recordId: source.id,
        revisionVersion: chosenVersion.version,
      }

      return addEvidenceSection(notebookDataClient, {
        workspaceId,
        definitionId,
        title: title.trim() || blockLabel(block.type),
        evidence,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: reportKeys.detail(recordId),
      })
      reset()
      onOpenChange(false)
    },
    onError: () => toast.error(t('projects.reports.evidence.failed')),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.reports.evidence.title')}
          description={t('projects.reports.evidence.body')}
        />
        <DialogBody>
          {records.isError ? (
            <Notice
              tone="bad"
              title={t('projects.reports.evidence.loadFailed')}
            />
          ) : null}
          <Field label={t('projects.reports.evidence.record')}>
            <PickerSelect
              noun="record"
              value={sourceId}
              placeholder={t('projects.reports.evidence.recordPlaceholder')}
              disabled={records.isLoading}
              onChange={chooseSource}
              options={(records.data ?? []).map((r) => ({
                id: r.id,
                identifier: r.identifier,
                label: r.title,
                detail: r.kind,
              }))}
            />
          </Field>
          {sourceId && !revisions.isLoading && versions.length === 0 ? (
            <Notice>{t('projects.reports.evidence.noVersions')}</Notice>
          ) : null}
          {versions.length > 0 ? (
            <Field label={t('projects.reports.evidence.version')}>
              <Select
                value={chosenVersion?.id ?? ''}
                onChange={(e) => chooseVersion(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t('projects.reports.evidence.versionLabel', {
                      n: v.version,
                    })}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {chosenVersion ? (
            <EvidenceBlockTable
              blocks={blocks.data ?? []}
              loading={blocks.isLoading}
              chosenId={blockId}
              onChoose={setBlockId}
            />
          ) : null}
          {block ? (
            <Field
              label={t('projects.reports.evidence.sectionTitle')}
              hint={t('projects.reports.evidence.sectionTitleHint')}
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!block || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending
              ? t('projects.reports.evidence.adding')
              : t('projects.reports.evidence.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
