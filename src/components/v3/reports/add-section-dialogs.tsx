import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
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
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Textarea } from '#/components/v3/inventory/list'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  addEvidenceSection,
  addTextSection,
  fetchEvidenceRevisions,
  fetchRevisionBlocks,
  reportKeys,
} from '#/lib/reports'
import type { EvidenceChoice } from '#/lib/reports'
import { BLOCK_PICKER_OPTIONS } from '#/lib/blocks/registry'
import { t } from '#/copy'

export function AddTextDialog({
  open,
  onOpenChange,
  recordId,
  definitionId,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  definitionId: string
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [touched, setTouched] = useState(false)
  const add = useMutation({
    mutationFn: () =>
      addTextSection(notebookDataClient, {
        workspaceId,
        definitionId,
        title,
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: reportKeys.detail(recordId),
      })
      setTitle('')
      setBody('')
      setTouched(false)
      onOpenChange(false)
    },
    onError: () => toast.error(t('projects.reports.addText.failed')),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.reports.addText.title')} />
        <DialogBody>
          <Field
            label={t('projects.reports.addText.titleField')}
            required
            error={
              touched && !title.trim()
                ? t('projects.reports.addText.titleError')
                : undefined
            }
          >
            <Input
              autoFocus
              value={title}
              placeholder={t('projects.reports.addText.titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('projects.reports.addText.bodyField')}>
            <Textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => {
              setTouched(true)
              if (title.trim()) add.mutate()
            }}
          >
            {add.isPending
              ? t('projects.reports.addText.adding')
              : t('projects.reports.addText.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SourceRecord {
  id: string
  identifier: string
  title: string
  kind: string
}

const blockLabel = (type: string) =>
  BLOCK_PICKER_OPTIONS.find((o) => o.type === type)?.label ?? type

/**
 * Bring evidence into a report: pick a record that has been submitted, pick
 * the version, then pick one block of it. The block is frozen as it was.
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
  const [sourceId, setSourceId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [blockId, setBlockId] = useState('')
  const [title, setTitle] = useState('')

  const records = useQuery({
    queryKey: [...reportKeys.evidenceRevisions(recordId), 'records', projectId],
    enabled: open,
    queryFn: () =>
      notebookDataClient.list<SourceRecord>(
        'records',
        `?select=id,identifier,title,kind,revisions!revisions_record_id_records_id_fk!inner(id)&revisions.limit=1&kind=neq.report&deleted_at=is.null${
          projectId ? `&project_id=eq.${projectId}` : ''
        }&order=identifier.asc&limit=200`,
      ),
  })
  const revisions = useQuery({
    queryKey: [
      ...reportKeys.evidenceRevisions(recordId),
      'revisions',
      sourceId,
    ],
    enabled: open && sourceId !== '',
    queryFn: () => fetchEvidenceRevisions(notebookDataClient, sourceId),
  })
  const versions = revisions.data ?? []
  const chosenVersion =
    versions.find((v) => v.id === versionId) ?? versions.at(0)
  const blocks = useQuery({
    queryKey: [
      ...reportKeys.evidenceRevisions(recordId),
      'blocks',
      chosenVersion?.id,
    ],
    enabled: open && Boolean(chosenVersion),
    queryFn: () =>
      fetchRevisionBlocks(notebookDataClient, chosenVersion?.id ?? ''),
  })
  const source = (records.data ?? []).find((r) => r.id === sourceId)
  const block = (blocks.data ?? []).find((b) => b.id === blockId)

  const reset = () => {
    setSourceId('')
    setVersionId('')
    setBlockId('')
    setTitle('')
  }
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
              onChange={(id) => {
                setSourceId(id)
                setVersionId('')
                setBlockId('')
              }}
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
                onChange={(e) => {
                  setVersionId(e.target.value)
                  setBlockId('')
                }}
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
            <TableBox className="max-h-64 overflow-y-auto">
              <Table caption={t('projects.reports.evidence.blocks')}>
                <TableHeader>
                  <tr>
                    <TableHead className="w-8" />
                    <TableHead>
                      {t('projects.reports.evidence.blockType')}
                    </TableHead>
                    <TableHead>
                      {t('projects.reports.evidence.blockText')}
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody
                  loading={blocks.isLoading}
                  empty={
                    (blocks.data ?? []).length === 0
                      ? t('projects.reports.evidence.noBlocks')
                      : undefined
                  }
                  colSpan={3}
                >
                  {(blocks.data ?? []).map((b) => (
                    <TableRow key={b.id} selected={b.id === blockId}>
                      <TableCell className="first:pl-6">
                        <input
                          type="radio"
                          name="evidence-block"
                          aria-label={blockLabel(b.type)}
                          checked={b.id === blockId}
                          onChange={() => setBlockId(b.id)}
                        />
                      </TableCell>
                      <TableCell>{blockLabel(b.type)}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-fg-muted">
                        {b.text || t('projects.reports.evidence.noText')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
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
