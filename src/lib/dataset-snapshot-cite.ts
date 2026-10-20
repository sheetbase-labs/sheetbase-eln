/**
 * Cite a dataset snapshot in a notebook.
 *
 * The notebook gets a record-reference block that names the dataset and pins
 * the exact snapshot (id and content hash), and the dataset is linked to the
 * experiment so it shows on its Links and Results tabs. The snapshot itself is
 * not changed: citing only adds references to it.
 */
import type { DataClient } from './data-client'
import { fetchRecord } from './notebook-data'
import { insertBlock } from './notebook-mutations'
import { isDuplicateLinkError } from './scientific-records'

export interface CiteSnapshotInput {
  /** The notebook (experiment) record that receives the reference. */
  recordId: string
  datasetId: string
  /** The dataset's display id (DS-0298); falls back to its name. */
  datasetIdentifier: string
  datasetName: string
  versionId: string
  versionLabel: string
  contentHash: string | null
}

export function snapshotCitationLabel(
  input: Pick<CiteSnapshotInput, 'datasetName' | 'versionLabel'>,
): string {
  return `${input.datasetName} · snapshot ${input.versionLabel}`
}

export async function citeSnapshotInNotebook(
  client: DataClient,
  input: CiteSnapshotInput,
): Promise<{ blockId: string }> {
  const record = await fetchRecord(client, input.recordId)
  const inserted = await insertBlock(client, {
    recordId: input.recordId,
    type: 'linked_record',
    payload: {
      targetKind: 'dataset',
      targetIdentifier: input.datasetIdentifier,
      targetId: input.datasetId,
      linkType: 'dataset',
      label: snapshotCitationLabel(input),
      datasetVersionId: input.versionId,
      datasetVersionHash: input.contentHash,
    },
    expectedStructureVersion: record?.structureVersion,
  })
  try {
    await client.rpc('create_record_link', {
      p_source_record_id: input.recordId,
      p_target_kind: 'dataset',
      p_target_identifier: input.datasetIdentifier,
      p_link_type: 'dataset',
      p_target_record_id: null,
    })
  } catch (error) {
    if (!isDuplicateLinkError(error)) throw error
  }
  return { blockId: inserted.block.id }
}
