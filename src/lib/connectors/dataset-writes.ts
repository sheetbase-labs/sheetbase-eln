/**
 * INT/connector write path for Datasets — deliberately a thin wrapper over the
 * canonical Core RPCs (`validate_dataset_row_batch`,
 * `commit_dataset_row_batch`). Connectors must not bypass canonical Dataset
 * validation; this module exists so ingestion has one typed seam to those
 * operations and no temptation toward direct table writes.
 */
import type { DataClient } from '../data-client'
import type {
  DatasetCommitResult,
  DatasetCommitRow,
} from '../dataset-product'
import { commitDatasetRowBatch, validateDatasetRowBatch } from '../dataset-product'

export interface DatasetBatchWriteInput {
  datasetId: string
  expectedRevision: number
  schemaVersionId: string
  rows: DatasetCommitRow[]
  idempotencyKey: string
}

export async function validateAndCommitDatasetRows(
  client: DataClient,
  input: DatasetBatchWriteInput,
): Promise<DatasetCommitResult> {
  const validated = await validateDatasetRowBatch(client, {
    datasetId: input.datasetId,
    expectedRevision: input.expectedRevision,
    rows: input.rows,
  })
  if (!validated.ok) return validated
  return commitDatasetRowBatch(client, {
    datasetId: input.datasetId,
    expectedRevision: input.expectedRevision,
    rows: input.rows,
    idempotencyKey: input.idempotencyKey,
  })
}
