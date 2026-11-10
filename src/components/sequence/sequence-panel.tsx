import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { uploadFileToExperiment } from '#/lib/experiment-files'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { SEQUENCE_ACCEPT, isSequenceFileName } from '#/lib/sequence'
import { cn } from '#/lib/utils'
import { SequenceFileViewer } from './sequence-viewer'
import { summaryLine } from './sequence-summary'
import { linkedSequencesKey, useLinkedSequences } from './use-linked-sequences'

/** The one-line summary, re-exported so callers keep one import. */
export { summaryLine } from './sequence-summary'

/**
 * The sequences on a record, a sample or a notebook: each is a stored GenBank
 * or FASTA file linked to it, and opens as a map.
 */
export function SequencePanel({
  recordId,
  projectId,
  canEdit,
  className,
}: {
  recordId: string
  /** The project the file is stored in: the host record's project. */
  projectId: string | null
  canEdit: boolean
  className?: string
}) {
  const sequences = useLinkedSequences(recordId)
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = sequences.data ?? []
  const shown = openId ?? (rows.length > 0 ? rows[0].fileRecordId : null)

  const add = useMutation({
    mutationFn: async (file: File) => {
      if (!projectId) throw new Error('This record is not in a project.')

      if (!isSequenceFileName(file.name))
        throw new Error(t('sequences.notSequence', { name: file.name }))
      // Browsers do not know these extensions; plain text is what they are.
      const asText = new File([file], file.name, { type: 'text/plain' })

      return uploadFileToExperiment(notebookDataClient, {
        projectId,
        experimentId: recordId,
        file: asText,
      })
    },
    onSuccess: (meta) => {
      toast(t('sequences.added'))
      setOpenId(meta.fileRecordId)
      void queryClient.invalidateQueries({
        queryKey: linkedSequencesKey(recordId),
      })
    },
    onError: (error: Error) =>
      toast.error(t('sequences.addFailed', { message: error.message })),
  })

  const addButton = canEdit ? (
    <>
      <input
        ref={input}
        type="file"
        accept={SEQUENCE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('sequences.add')}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''

          if (file) add.mutate(file)
        }}
      />
      <Button
        size="sm"
        icon="plus"
        disabled={add.isPending}
        title={t('sequences.addHint')}
        onClick={() => input.current?.click()}
      >
        {add.isPending ? t('sequences.adding') : t('sequences.add')}
      </Button>
    </>
  ) : null

  return (
    <div className={cn('flex flex-col gap-5 p-6 max-md:p-3', className)}>
      <Section
        title={t('sequences.title')}
        count={rows.length > 0 ? rows.length : undefined}
        action={addButton}
      >
        {rows.length === 0 && !sequences.isPending ? (
          <EmptyState
            icon="file"
            title={t('sequences.empty.title')}
            description={t('sequences.empty.description')}
            action={addButton}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface">
            {rows.map((row) => (
              <li key={row.fileRecordId}>
                <button
                  type="button"
                  aria-pressed={row.fileRecordId === shown}
                  onClick={() => setOpenId(row.fileRecordId)}
                  className={cn(
                    'flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-focus',
                    row.fileRecordId === shown && 'bg-selection',
                  )}
                >
                  <span className="text-body font-medium text-fg">
                    {row.name}
                  </span>
                  <span className="num text-label text-fg-muted">
                    {row.summary ? summaryLine(row.summary) : null}
                  </span>
                  <span className="num ml-auto text-label text-fg-faint">
                    {formatDate(row.addedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {shown ? <SequenceFileViewer key={shown} fileRecordId={shown} /> : null}
    </div>
  )
}
