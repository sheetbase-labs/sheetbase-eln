import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchEvidenceRevisions,
  fetchRevisionBlocks,
  reportKeys,
} from '#/lib/reports'

export interface SourceRecord {
  id: string
  identifier: string
  title: string
  kind: string
}

/**
 * What the Add Evidence dialog knows while a person picks their way down: the
 * submitted records to choose from, the versions of the chosen record, the
 * blocks of the chosen version, and which of each is selected. It reads; it does
 * not write. The dialog renders what this returns and commits the choice.
 */
export function useEvidencePicker({
  open,
  recordId,
  projectId,
}: {
  open: boolean
  recordId: string
  projectId: string | null
}) {
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

  /** A different record makes the version and block chosen from it meaningless. */
  const chooseSource = (id: string) => {
    setSourceId(id)
    setVersionId('')
    setBlockId('')
  }

  /** A different version makes the block chosen from it meaningless. */
  const chooseVersion = (id: string) => {
    setVersionId(id)
    setBlockId('')
  }

  return {
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
  }
}
